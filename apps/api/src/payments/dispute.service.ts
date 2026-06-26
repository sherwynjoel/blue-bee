import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DisputeStatus, type DisputeView } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { centsToMoney, decimalMoney } from '../orders/money';

/** Map a Stripe dispute status to our coarse lifecycle (we record + surface; we never adjudicate). */
export function mapDisputeStatus(stripeStatus: string): DisputeStatus {
  switch (stripeStatus) {
    case 'won':
      return DisputeStatus.WON;
    case 'lost':
      return DisputeStatus.LOST;
    case 'under_review':
    case 'warning_under_review':
      return DisputeStatus.UNDER_REVIEW;
    case 'needs_response':
    case 'warning_needs_response':
      return DisputeStatus.OPEN;
    default:
      return DisputeStatus.CLOSED;
  }
}

export interface DisputeEffect {
  disputeId: string;
  orgId: string;
  orderId: string | null;
  paymentId: string | null;
  amount: string;
  currency: string;
  reason: string | null;
}

/**
 * Disputes / chargebacks (Increment 12) — `charge.dispute.created`/`.closed` are recorded as a
 * Dispute row + audited + surfaced + alerted to owner/finance (via the Inc-8 engine). We do NOT
 * adjudicate. Idempotent on the Stripe dispute id.
 */
@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async applyDisputeCreated(
    tx: Prisma.TransactionClient,
    args: { stripeDisputeId: string; intentId: string | null; chargeId: string | null; amountMinor: number; currency: string; reason: string | null; status: string; evidenceDueBy: Date | null },
  ): Promise<DisputeEffect | null> {
    const payment = await tx.payment.findFirst({
      where: { OR: [...(args.intentId ? [{ stripePaymentIntentId: args.intentId }] : []), ...(args.chargeId ? [{ stripeChargeId: args.chargeId }] : [])] },
    });
    // A dispute may arrive for a charge we can't map (e.g. created out-of-band); still record it for
    // the org if we can infer one from the payment, else skip (no cross-tenant guess).
    if (!payment) return null;

    const existing = await tx.dispute.findUnique({ where: { stripeDisputeId: args.stripeDisputeId } });
    if (existing) {
      return { disputeId: existing.id, orgId: existing.orgId, orderId: existing.orderId, paymentId: existing.paymentId, amount: decimalMoney(existing.amount), currency: existing.currency, reason: existing.reason };
    }
    const dispute = await tx.dispute.create({
      data: {
        orgId: payment.orgId,
        paymentId: payment.id,
        orderId: payment.orderId,
        stripeDisputeId: args.stripeDisputeId,
        amount: centsToMoney(args.amountMinor),
        currency: args.currency.toUpperCase(),
        reason: args.reason,
        status: mapDisputeStatus(args.status),
        evidenceDueBy: args.evidenceDueBy,
        openedAt: new Date(),
      },
    });
    await this.audit.record(
      { orgId: payment.orgId, actorId: null, entity: 'Dispute', entityId: dispute.id, action: 'DISPUTE_OPENED', after: { stripeDisputeId: args.stripeDisputeId, amount: centsToMoney(args.amountMinor), reason: args.reason } },
      tx,
    );
    return { disputeId: dispute.id, orgId: payment.orgId, orderId: payment.orderId, paymentId: payment.id, amount: centsToMoney(args.amountMinor), currency: args.currency.toUpperCase(), reason: args.reason };
  }

  async applyDisputeClosed(
    tx: Prisma.TransactionClient,
    args: { stripeDisputeId: string; status: string },
  ): Promise<DisputeEffect | null> {
    const dispute = await tx.dispute.findUnique({ where: { stripeDisputeId: args.stripeDisputeId } });
    if (!dispute) return null;
    const nextStatus = mapDisputeStatus(args.status);
    if (dispute.status !== nextStatus) {
      await tx.dispute.update({ where: { id: dispute.id }, data: { status: nextStatus, resolvedAt: new Date() } });
      await this.audit.record(
        { orgId: dispute.orgId, actorId: null, entity: 'Dispute', entityId: dispute.id, action: 'DISPUTE_CLOSED', before: { status: dispute.status }, after: { status: nextStatus } },
        tx,
      );
    }
    return { disputeId: dispute.id, orgId: dispute.orgId, orderId: dispute.orderId, paymentId: dispute.paymentId, amount: decimalMoney(dispute.amount), currency: dispute.currency, reason: dispute.reason };
  }

  // ─────────────────────────── owner/finance read (API built; owner-app screens deferred) ───────────────────────────

  async listDisputes(principal: RequestPrincipal): Promise<DisputeView[]> {
    const rows = await this.prisma.dispute.findMany({ where: { orgId: principal.orgId }, orderBy: { openedAt: 'desc' }, take: 200 });
    return rows.map((d) => ({
      id: d.id,
      paymentId: d.paymentId ?? '',
      orderId: d.orderId,
      amount: decimalMoney(d.amount),
      currency: d.currency,
      status: d.status,
      reason: d.reason,
      openedAt: d.openedAt.toISOString(),
      resolvedAt: d.resolvedAt ? d.resolvedAt.toISOString() : null,
    }));
  }
}
