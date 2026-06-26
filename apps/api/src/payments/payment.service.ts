import { ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OrderStatus,
  PaymentStatus,
  PAYMENT_ERRORS,
  QuoteStatus,
  type CreatePaymentIntentDto,
  type PaymentIntentResponse,
  type PaymentView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import { OrderAccessService } from '../orders/order-access.service';
import { OrderStateMachine } from '../orders/state-machine.service';
import { centsToMoney, decimalMoney, moneyToCents } from '../orders/money';
import type { RequestPrincipal } from '../auth/rbac/types';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../config/payments.config';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider';

/** Order states from which a payment may NOT be taken (pre-approval or terminated without work). */
const NON_PAYABLE: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.SCHEDULED_PICKUP,
  OrderStatus.PICKUP_EN_ROUTE,
  OrderStatus.PICKED_UP,
  OrderStatus.INTAKE_INSPECTED,
  OrderStatus.DAMAGE_PREEXISTING_FLAGGED,
  OrderStatus.QUOTED,
  OrderStatus.QUOTE_DECLINED,
  OrderStatus.CLOSED_NO_WORK,
];

/** A descriptor the webhook orchestrator uses to fire post-commit notifications + invoicing. */
export interface PaymentSucceededEffect {
  paymentId: string;
  orgId: string;
  orderId: string | null;
  accountId: string | null;
  amount: string;
  currency: string;
}
export interface PaymentFailedEffect {
  paymentId: string;
  orgId: string;
  orderId: string | null;
  amount: string;
  currency: string;
}

/**
 * Take-payment core (Increment 12) — creates the PaymentIntent for an APPROVED order's
 * SERVER-COMPUTED amount (the approved quote total incl. HST; never a client amount), behind the
 * PaymentProvider seam, with a deterministic Stripe idempotency key so a retry never double-charges.
 * The customer app receives ONLY the client secret (PCI SAQ-A).
 *
 * The Payment status machine (PENDING → SUCCEEDED | FAILED) is advanced ONLY by the
 * signature-verified webhook (`applyPaymentSucceeded`/`applyPaymentFailed`, run inside the webhook's
 * atomic transaction) — never on the client's say-so.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    private readonly stateMachine: OrderStateMachine,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ─────────────────────────── customer: create / re-attempt intent ───────────────────────────

  async createIntent(principal: RequestPrincipal, orderId: string, _dto: CreatePaymentIntentDto): Promise<PaymentIntentResponse> {
    // Ownership + scope (customer pays only their own order → 403 cross-account / 404 cross-org).
    const order = await this.access.requireOrderForWrite(principal, orderId);
    const status = order.status as unknown as OrderStatus;
    if (NON_PAYABLE.includes(status)) {
      throw new ConflictException({ error: PAYMENT_ERRORS.ORDER_NOT_PAYABLE, message: `Order ${orderId} is not payable in status ${status}` });
    }

    const quote = await this.prisma.quote.findFirst({
      where: { orderId, orgId: order.orgId, status: QuoteStatus.APPROVED },
      orderBy: { approvedAt: 'desc' },
    });
    if (!quote) {
      throw new ConflictException({ error: PAYMENT_ERRORS.NO_APPROVED_QUOTE, message: 'No approved quote to charge on this order' });
    }
    const amountStr = decimalMoney(quote.total);
    const amountMinor = moneyToCents(amountStr);
    const currency = this.config.currency;

    // Already fully paid?
    const succeeded = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED } });
    if (succeeded) {
      throw new ConflictException({ error: PAYMENT_ERRORS.ALREADY_PAID, message: 'This order has already been paid' });
    }

    // Re-attempt of the SAME pending intent: re-call the provider with the stored idempotency key so
    // Stripe returns the identical intent + client secret (no double-charge, no secret persistence).
    const pending = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.PENDING }, orderBy: { createdAt: 'desc' } });
    if (pending && pending.idempotencyKey) {
      const intent = await this.provider.createPaymentIntent({
        amountMinor,
        currency: currency.toLowerCase(),
        orderId,
        orgId: order.orgId,
        accountId: order.accountId,
        idempotencyKey: pending.idempotencyKey,
        captureMethod: this.captureMethod(),
      });
      // Keep the stored intent id in sync (idempotent — same key ⇒ same id).
      if (pending.stripePaymentIntentId !== intent.id) {
        await this.prisma.payment.update({ where: { id: pending.id }, data: { stripePaymentIntentId: intent.id } });
      }
      return this.intentResponse(pending.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING);
    }

    // New attempt — bounded by the dunning retry cap.
    const attempts = await this.prisma.payment.count({ where: { orderId, orgId: order.orgId } });
    if (attempts >= this.config.maxPaymentAttempts) {
      throw new ConflictException({ error: PAYMENT_ERRORS.RETRY_LIMIT_REACHED, message: 'Payment retry limit reached; please contact support' });
    }

    const idempotencyKey = `pi-order-${orderId}-${attempts + 1}`;
    const payment = await this.prisma.payment.create({
      data: {
        orgId: order.orgId,
        orderId,
        accountId: order.accountId,
        amount: amountStr,
        currency,
        status: PaymentStatus.PENDING,
        captureMethod: this.captureMethod(),
        idempotencyKey,
        attempts: attempts + 1,
        createdBy: principal.userId,
      },
    });

    let intent;
    try {
      intent = await this.provider.createPaymentIntent({
        amountMinor,
        currency: currency.toLowerCase(),
        orderId,
        orgId: order.orgId,
        accountId: order.accountId,
        idempotencyKey,
        captureMethod: this.captureMethod(),
      });
    } catch (err) {
      // The intent couldn't be created — mark this attempt FAILED so the row isn't a dangling PENDING.
      const reason = err instanceof Error ? err.message : String(err);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, lastError: reason } });
      throw new UnprocessableEntityException({ error: PAYMENT_ERRORS.ORDER_NOT_PAYABLE, message: `Could not start payment: ${reason}` });
    }

    await this.prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id } });
    await this.audit.record({
      orgId: order.orgId,
      actorId: principal.userId,
      entity: 'Payment',
      entityId: payment.id,
      action: 'PAYMENT_INTENT_CREATED',
      after: { orderId, amount: amountStr, currency, intentId: intent.id, attempt: attempts + 1, provider: this.provider.name },
    });

    return this.intentResponse(payment.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING);
  }

  // ─────────────────────────── reads ───────────────────────────

  /** The order's current payment (latest), scoped — for the app's Pay surface. Null when none. */
  async getPaymentForOrder(principal: RequestPrincipal, orderId: string): Promise<PaymentView | null> {
    const order = await this.access.getOrderForRead(principal, orderId); // scope → 404 if not visible
    const p = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId }, orderBy: { createdAt: 'desc' } });
    return p ? toPaymentView(p) : null;
  }

  // ─────────────────────────── webhook-driven transitions (run inside the webhook tx) ───────────────────────────

  /**
   * Apply `payment_intent.succeeded` (inside the webhook tx). Marks the Payment SUCCEEDED + captured,
   * mirrors order.totals.paymentStatus = PAID, and (if the order is already DELIVERED) advances
   * DELIVERED → INVOICED. Idempotent: a re-applied succeeded event is a no-op. Returns the effect
   * descriptor for post-commit invoicing + receipt, or null when the intent maps to no Payment row.
   */
  async applyPaymentSucceeded(
    tx: Prisma.TransactionClient,
    intentId: string,
    chargeId: string | null,
    amountMinor: number | null,
  ): Promise<PaymentSucceededEffect | null> {
    const payment = await tx.payment.findFirst({ where: { stripePaymentIntentId: intentId } });
    if (!payment) return null; // not ours / not mapped → recorded + ignored (no cross-tenant guess)
    if (payment.status === PaymentStatus.SUCCEEDED) {
      return this.toSucceededEffect(payment); // already applied (idempotent)
    }
    const capturedMinor = amountMinor ?? moneyToCents(String(payment.amount));
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.SUCCEEDED,
        capturedAmount: centsToMoney(capturedMinor),
        capturedAt: new Date(),
        stripeChargeId: chargeId ?? payment.stripeChargeId,
        stripeRef: chargeId ?? payment.stripeRef,
        lastError: null,
      },
    });
    if (payment.orderId) {
      await this.mirrorOrderPaymentStatus(tx, payment.orgId, payment.orderId, 'PAID');
      await this.maybeAdvanceToInvoiced(tx, payment.orgId, payment.orderId);
    }
    await this.audit.record(
      { orgId: payment.orgId, actorId: null, entity: 'Payment', entityId: payment.id, action: 'PAYMENT_SUCCEEDED', after: { intentId, chargeId, amount: centsToMoney(capturedMinor) } },
      tx,
    );
    return this.toSucceededEffect({ ...payment, capturedAmount: centsToMoney(capturedMinor) as unknown as typeof payment.capturedAmount });
  }

  /** Apply `payment_intent.payment_failed` (inside the webhook tx). Marks the Payment FAILED + records
   *  the reason; mirrors order.totals.paymentStatus = FAILED. Returns the descriptor for dunning. */
  async applyPaymentFailed(tx: Prisma.TransactionClient, intentId: string, lastError: string | null): Promise<PaymentFailedEffect | null> {
    const payment = await tx.payment.findFirst({ where: { stripePaymentIntentId: intentId } });
    if (!payment) return null;
    if (payment.status === PaymentStatus.FAILED) return this.toFailedEffect(payment, lastError);
    if (payment.status !== PaymentStatus.PENDING) return null; // can't fail a captured/refunded payment
    await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, lastError: lastError ?? 'payment failed' } });
    if (payment.orderId) await this.mirrorOrderPaymentStatus(tx, payment.orgId, payment.orderId, 'FAILED');
    await this.audit.record(
      { orgId: payment.orgId, actorId: null, entity: 'Payment', entityId: payment.id, action: 'PAYMENT_FAILED', after: { intentId, reason: lastError } },
      tx,
    );
    return this.toFailedEffect(payment, lastError);
  }

  // ─────────────────────────── internals ───────────────────────────

  /** Charge-on-approval (default) ⇒ automatic capture; capture-later setting ⇒ manual (seam-ready). */
  private captureMethod(): 'automatic' | 'manual' {
    return this.config.captureTiming === 'on_delivery' ? 'manual' : 'automatic';
  }

  /** Mirror a coarse paymentStatus onto order.totals (the order's BILLING state — advanced only on a
   *  webhook-confirmed event), preserving the rest of the totals JSON. */
  private async mirrorOrderPaymentStatus(tx: Prisma.TransactionClient, orgId: string, orderId: string, paymentStatus: 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'): Promise<void> {
    const order = await tx.order.findFirst({ where: { id: orderId, orgId } });
    if (!order) return;
    const totals = { ...((order.totals as Record<string, unknown>) ?? {}), paymentStatus };
    await tx.order.update({ where: { id: orderId }, data: { totals: totals as Prisma.InputJsonValue } });
  }

  /** When a DELIVERED order is paid, advance the §5.1 spine DELIVERED → INVOICED (conservative — does
   *  nothing for the common charge-on-approval case where the order is still mid-fulfilment). */
  private async maybeAdvanceToInvoiced(tx: Prisma.TransactionClient, orgId: string, orderId: string): Promise<void> {
    const order = await tx.order.findFirst({ where: { id: orderId, orgId } });
    if (!order) return;
    if ((order.status as unknown as OrderStatus) === OrderStatus.DELIVERED) {
      await this.stateMachine.apply(tx, order, OrderStatus.INVOICED, { actorId: null, reason: 'payment confirmed' });
    }
  }

  private toSucceededEffect(p: { id: string; orgId: string; orderId: string | null; accountId: string | null; capturedAmount: Prisma.Decimal | string; amount: Prisma.Decimal | string; currency: string }): PaymentSucceededEffect {
    return { paymentId: p.id, orgId: p.orgId, orderId: p.orderId, accountId: p.accountId, amount: decimalMoney(p.amount), currency: p.currency };
  }
  private toFailedEffect(p: { id: string; orgId: string; orderId: string | null; amount: Prisma.Decimal | string; currency: string }, _err: string | null): PaymentFailedEffect {
    return { paymentId: p.id, orgId: p.orgId, orderId: p.orderId, amount: decimalMoney(p.amount), currency: p.currency };
  }

  private intentResponse(paymentId: string, clientSecret: string, amount: string, currency: string, status: PaymentStatus): PaymentIntentResponse {
    return { paymentId, clientSecret, amount, currency, status, publishableKey: this.config.stripe.publishableKey };
  }
}

/** Map a Payment row to its safe view shape (no Stripe secrets, no card data). */
export function toPaymentView(p: {
  id: string;
  orderId: string | null;
  invoiceId: string | null;
  method: string;
  amount: Prisma.Decimal | string;
  currency: string;
  status: string;
  capturedAmount: Prisma.Decimal | string;
  refundedAmount: Prisma.Decimal | string;
  attempts: number;
  createdAt: Date;
  capturedAt: Date | null;
}): PaymentView {
  return {
    id: p.id,
    orderId: p.orderId,
    invoiceId: p.invoiceId,
    method: p.method as PaymentView['method'],
    amount: decimalMoney(p.amount),
    currency: p.currency,
    status: p.status as PaymentView['status'],
    capturedAmount: decimalMoney(p.capturedAmount),
    refundedAmount: decimalMoney(p.refundedAmount),
    attempts: p.attempts,
    createdAt: p.createdAt.toISOString(),
    capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
  };
}
