import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentStatus, PAYMENT_ERRORS, RefundStatus, type RefundPaymentDto, type RefundView } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { centsToMoney, decimalMoney, moneyToCents } from '../orders/money';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider';
import { isFullyRefunded, resolveRefundCents } from './payment-state';

/**
 * Refunds (Increment 12) — full + partial, owner/finance only. The authenticated initiation
 * ATOMICALLY reserves the amount against the captured balance (refund ≤ captured, no double-refund,
 * concurrency-safe via an optimistic guard) and calls the provider behind the seam; the
 * `charge.refunded` webhook reconciles to Stripe's authoritative refunded total (idempotent on
 * redelivery + handles dashboard-initiated refunds the API never saw).
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ─────────────────────────── owner/finance: initiate ───────────────────────────

  async refund(principal: RequestPrincipal, paymentId: string, dto: RefundPaymentDto): Promise<RefundView> {
    const payment = await this.prisma.payment.findFirst({ where: { id: paymentId, orgId: principal.orgId } });
    if (!payment) throw new NotFoundException({ error: PAYMENT_ERRORS.PAYMENT_NOT_FOUND, message: `Payment ${paymentId} not found` });
    if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.REFUNDED) {
      throw new ConflictException({ error: PAYMENT_ERRORS.NOT_REFUNDABLE, message: `Only a captured payment can be refunded (status ${payment.status})` });
    }
    if (!payment.stripePaymentIntentId) {
      throw new ConflictException({ error: PAYMENT_ERRORS.NOT_REFUNDABLE, message: 'Payment has no captured charge to refund' });
    }

    const capturedCents = moneyToCents(String(payment.capturedAmount));
    const refundedCents = moneyToCents(String(payment.refundedAmount));
    let resolved: { cents: number; isFull: boolean };
    try {
      resolved = resolveRefundCents(capturedCents, refundedCents, dto.amount !== undefined ? moneyToCents(dto.amount.toFixed(2)) : undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new UnprocessableEntityException({ error: PAYMENT_ERRORS.REFUND_EXCEEDS_CAPTURED, message: msg });
    }

    const newRefundedCents = refundedCents + resolved.cents;
    const fullyRefunded = isFullyRefunded(capturedCents, newRefundedCents);

    // ── Atomic reserve ── increment refundedAmount only if it is STILL the value we validated against
    // (optimistic concurrency) so two concurrent refunds can never exceed the captured balance.
    const reserve = await this.prisma.payment.updateMany({
      where: { id: paymentId, orgId: principal.orgId, refundedAmount: centsToMoney(refundedCents) },
      data: {
        refundedAmount: centsToMoney(newRefundedCents),
        ...(fullyRefunded ? { status: PaymentStatus.REFUNDED } : {}),
      },
    });
    if (reserve.count !== 1) {
      throw new ConflictException({ error: PAYMENT_ERRORS.ILLEGAL_TRANSITION, message: 'Payment was concurrently modified; retry the refund' });
    }

    const refundRow = await this.prisma.refund.create({
      data: {
        orgId: payment.orgId,
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: centsToMoney(resolved.cents),
        currency: payment.currency,
        reason: dto.reason ?? null,
        status: RefundStatus.PENDING,
        createdBy: principal.userId,
      },
    });

    try {
      const result = await this.provider.refund({
        paymentIntentId: payment.stripePaymentIntentId,
        amountMinor: resolved.cents,
        reason: dto.reason,
        idempotencyKey: `re-${refundRow.id}`,
        orgId: payment.orgId,
        orderId: payment.orderId,
      });
      await this.prisma.refund.update({
        where: { id: refundRow.id },
        data: {
          stripeRefundId: result.id,
          status: result.status === 'succeeded' ? RefundStatus.SUCCEEDED : RefundStatus.PENDING,
        },
      });
    } catch (err) {
      // The provider rejected the refund — release the reserve so the balance is correct again.
      const reason = err instanceof Error ? err.message : String(err);
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { refundedAmount: centsToMoney(refundedCents), ...(payment.status === PaymentStatus.REFUNDED ? {} : { status: payment.status }) },
      });
      await this.prisma.refund.update({ where: { id: refundRow.id }, data: { status: RefundStatus.FAILED, reason } });
      throw new UnprocessableEntityException({ error: PAYMENT_ERRORS.NOT_REFUNDABLE, message: `Refund failed: ${reason}` });
    }

    await this.mirrorOrderPaymentStatus(payment.orgId, payment.orderId, fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
    await this.audit.record({
      orgId: payment.orgId,
      actorId: principal.userId,
      entity: 'Payment',
      entityId: payment.id,
      action: 'REFUND_INITIATED',
      after: { refundId: refundRow.id, amount: centsToMoney(resolved.cents), full: resolved.isFull },
    });

    return this.toView(refundRow.id);
  }

  // ─────────────────────────── webhook: reconcile (inside the webhook tx) ───────────────────────────

  /**
   * Apply `charge.refunded`. Reconciles Payment.refundedAmount to Stripe's authoritative total
   * (idempotent), confirms any PENDING refund rows, creates a SUCCEEDED row for any delta refunded
   * outside our API (e.g. the Stripe dashboard), and flips the Payment to REFUNDED when fully
   * refunded. Returns a descriptor for an optional notification, or null when unmapped.
   */
  async applyChargeRefunded(
    tx: Prisma.TransactionClient,
    intentId: string | null,
    chargeId: string | null,
    totalRefundedMinor: number,
  ): Promise<{ orgId: string; orderId: string | null; fullyRefunded: boolean } | null> {
    const payment = await tx.payment.findFirst({
      where: { OR: [...(intentId ? [{ stripePaymentIntentId: intentId }] : []), ...(chargeId ? [{ stripeChargeId: chargeId }] : [])] },
    });
    if (!payment) return null;

    const capturedCents = moneyToCents(String(payment.capturedAmount));
    const currentRefundedCents = moneyToCents(String(payment.refundedAmount));
    const newRefundedCents = Math.max(currentRefundedCents, totalRefundedMinor);
    const fullyRefunded = isFullyRefunded(capturedCents, newRefundedCents);

    if (newRefundedCents > currentRefundedCents) {
      // A delta we hadn't recorded (dashboard-initiated refund) → persist a SUCCEEDED Refund row.
      await tx.refund.create({
        data: {
          orgId: payment.orgId,
          paymentId: payment.id,
          orderId: payment.orderId,
          amount: centsToMoney(newRefundedCents - currentRefundedCents),
          currency: payment.currency,
          reason: 'reconciled from charge.refunded',
          status: RefundStatus.SUCCEEDED,
          stripeRefundId: chargeId ? `${chargeId}:reconciled` : null,
        },
      });
    }
    // Confirm any of our own PENDING refunds for this payment.
    await tx.refund.updateMany({ where: { paymentId: payment.id, status: RefundStatus.PENDING }, data: { status: RefundStatus.SUCCEEDED } });

    await tx.payment.update({
      where: { id: payment.id },
      data: { refundedAmount: centsToMoney(newRefundedCents), ...(fullyRefunded ? { status: PaymentStatus.REFUNDED } : {}) },
    });
    if (payment.orderId) await this.mirrorOrderPaymentStatusTx(tx, payment.orgId, payment.orderId, fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
    await this.audit.record(
      { orgId: payment.orgId, actorId: null, entity: 'Payment', entityId: payment.id, action: 'CHARGE_REFUNDED', after: { refundedTotal: centsToMoney(newRefundedCents), fullyRefunded } },
      tx,
    );
    return { orgId: payment.orgId, orderId: payment.orderId, fullyRefunded };
  }

  // ─────────────────────────── internals ───────────────────────────

  private async mirrorOrderPaymentStatus(orgId: string, orderId: string | null, status: 'REFUNDED' | 'PARTIALLY_REFUNDED'): Promise<void> {
    if (!orderId) return;
    const order = await this.prisma.order.findFirst({ where: { id: orderId, orgId } });
    if (!order) return;
    const totals = { ...((order.totals as Record<string, unknown>) ?? {}), paymentStatus: status };
    await this.prisma.order.update({ where: { id: orderId }, data: { totals: totals as Prisma.InputJsonValue } });
  }

  private async mirrorOrderPaymentStatusTx(tx: Prisma.TransactionClient, orgId: string, orderId: string, status: 'REFUNDED' | 'PARTIALLY_REFUNDED'): Promise<void> {
    const order = await tx.order.findFirst({ where: { id: orderId, orgId } });
    if (!order) return;
    const totals = { ...((order.totals as Record<string, unknown>) ?? {}), paymentStatus: status };
    await tx.order.update({ where: { id: orderId }, data: { totals: totals as Prisma.InputJsonValue } });
  }

  private async toView(refundId: string): Promise<RefundView> {
    const r = await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    return {
      id: r.id,
      paymentId: r.paymentId,
      amount: decimalMoney(r.amount),
      currency: r.currency,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
