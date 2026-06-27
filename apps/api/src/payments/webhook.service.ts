import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { NOTIFICATION_EVENTS, PAYMENT_ERRORS, STRIPE_HANDLED_EVENTS } from '@blue-bee/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { StripeEventVerifier } from './provider/stripe-event.verifier';
import { PaymentService, type PaymentFailedEffect, type PaymentSucceededEffect } from './payment.service';
import { BillingService } from './billing.service';
import { RefundService } from './refund.service';
import { DisputeService, type DisputeEffect } from './dispute.service';

/** What the apply step hands back for post-commit side effects (invoicing + notifications). */
type WebhookEffect =
  | { kind: 'succeeded'; payment: PaymentSucceededEffect }
  | { kind: 'failed'; payment: PaymentFailedEffect }
  | { kind: 'dispute'; dispute: DisputeEffect }
  | null;

/** Stripe sends string-or-expanded for nested refs; this normalizes to the id string (or null). */
function refId(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/**
 * The webhook orchestrator (Increment 12, §10.x WEBHOOKS) — the SINGLE SOURCE OF TRUTH for payment
 * state. Flow:
 *   1. Verify the RAW body signature (StripeEventVerifier) — a forged/unsigned/tampered body throws
 *      → the controller returns 400. We NEVER trust the client's "it succeeded".
 *   2. In ONE transaction: claim the event id in ProcessedStripeEvent (INSERT … ON CONFLICT DO
 *      NOTHING) — a redelivered/concurrent event matches the existing row and is a no-op — then drive
 *      the relevant state machine. The claim + the state change commit atomically, so a row's
 *      existence means the event was fully applied; nothing double-applies.
 *   3. After commit, fire post-commit side effects (auto-invoice/receipt, dunning, dispute alert)
 *      through the Inc-8 engine — isolated + idempotent.
 */
@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: StripeEventVerifier,
    private readonly payments: PaymentService,
    private readonly billing: BillingService,
    private readonly refunds: RefundService,
    private readonly disputes: DisputeService,
    private readonly notifications: NotificationService,
  ) {}

  async handle(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    if (!signature) throw new BadRequestException({ error: PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID, message: 'missing stripe-signature header' });

    let event: Stripe.Event;
    try {
      event = this.verifier.constructEvent(rawBody, signature);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`rejected webhook (signature): ${reason}`);
      throw new BadRequestException({ error: PAYMENT_ERRORS.WEBHOOK_SIGNATURE_INVALID, message: 'invalid webhook signature' });
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const claimed = await this.claimEvent(tx, event);
      if (!claimed) {
        this.logger.log(`stripe event ${event.id} (${event.type}) already processed — no-op`);
        return { duplicate: true as const };
      }
      const effect = await this.apply(tx, event);
      return { duplicate: false as const, effect };
    });

    if (!outcome.duplicate) await this.fireSideEffects(outcome.effect);
    return { received: true };
  }

  /** Idempotent claim: existence of the row == fully processed (committed atomically with apply). */
  private async claimEvent(tx: Prisma.TransactionClient, event: Stripe.Event): Promise<boolean> {
    const orgId = this.orgIdFromEvent(event);
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "ProcessedStripeEvent" ("id", "event_id", "type", "org_id", "received_at", "created_at")
      VALUES (${randomUUID()}::uuid, ${event.id}, ${event.type}, ${orgId}::uuid, now(), now())
      ON CONFLICT ("event_id") DO NOTHING
      RETURNING id::text AS "id"
    `);
    return rows.length > 0;
  }

  /** Drive the right state machine. Returns a post-commit descriptor (or null for handled-no-op). */
  private async apply(tx: Prisma.TransactionClient, event: Stripe.Event): Promise<WebhookEffect> {
    switch (event.type) {
      case STRIPE_HANDLED_EVENTS.PAYMENT_INTENT_SUCCEEDED: {
        const pi = event.data.object as Stripe.PaymentIntent;
        const amount = pi.amount_received ?? pi.amount;
        const effect = await this.payments.applyPaymentSucceeded(tx, pi.id, refId(pi.latest_charge as never), amount);
        return effect ? { kind: 'succeeded', payment: effect } : null;
      }
      case STRIPE_HANDLED_EVENTS.PAYMENT_INTENT_FAILED: {
        const pi = event.data.object as Stripe.PaymentIntent;
        const msg = pi.last_payment_error?.message ?? 'payment failed';
        const effect = await this.payments.applyPaymentFailed(tx, pi.id, msg);
        return effect ? { kind: 'failed', payment: effect } : null;
      }
      case STRIPE_HANDLED_EVENTS.CHARGE_REFUNDED: {
        const charge = event.data.object as Stripe.Charge;
        await this.refunds.applyChargeRefunded(tx, refId(charge.payment_intent as never), charge.id, charge.amount_refunded);
        return null;
      }
      case STRIPE_HANDLED_EVENTS.DISPUTE_CREATED: {
        const d = event.data.object as Stripe.Dispute;
        const effect = await this.disputes.applyDisputeCreated(tx, {
          stripeDisputeId: d.id,
          intentId: refId(d.payment_intent as never),
          chargeId: refId(d.charge as never),
          amountMinor: d.amount,
          currency: d.currency,
          reason: d.reason ?? null,
          status: d.status,
          evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
        });
        return effect ? { kind: 'dispute', dispute: effect } : null;
      }
      case STRIPE_HANDLED_EVENTS.DISPUTE_CLOSED: {
        const d = event.data.object as Stripe.Dispute;
        const effect = await this.disputes.applyDisputeClosed(tx, { stripeDisputeId: d.id, status: d.status });
        return effect ? { kind: 'dispute', dispute: effect } : null;
      }
      case STRIPE_HANDLED_EVENTS.INVOICE_PAID: {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.id) await this.billing.applyInvoicePaid(tx, inv.id);
        return null;
      }
      case STRIPE_HANDLED_EVENTS.INVOICE_PAYMENT_FAILED: {
        const inv = event.data.object as Stripe.Invoice;
        if (inv.id) await this.billing.applyInvoicePaymentFailed(tx, inv.id);
        return null;
      }
      default:
        this.logger.log(`stripe event ${event.id} (${event.type}) recorded but not handled`);
        return null;
    }
  }

  /** Post-commit side effects: auto-invoice + receipt on success, dunning on failure, staff dispute
   *  alert. Each is isolated + idempotent; a failure here can't corrupt the already-committed financial
   *  state. NOTE (accepted limitation, consistent with the Inc-8 geofence engine): these run AFTER the
   *  webhook tx commits, and the event is already in ProcessedStripeEvent, so a Stripe redelivery is a
   *  no-op — i.e. a process crash in this exact window would skip a receipt/dunning notification. The
   *  financial record (Payment/Invoice) is durable + correct; the notification is best-effort and can
   *  be re-sent. (A future recovery scan over committed payments with no receipt row would close it.) */
  private async fireSideEffects(effect: WebhookEffect): Promise<void> {
    if (!effect) return;
    try {
      if (effect.kind === 'succeeded') {
        // Order-level pay: create/mark the order's PAID receipt invoice (no-op for an invoice-level
        // pay — the targeted invoice was already flipped PAID in the webhook tx). Either way, send the
        // customer receipt, resolving recipients by order OR (invoice-level pay) by account.
        await this.billing.ensureInvoiceForPayment(effect.payment);
        await this.notifications.dispatchPayment({
          orgId: effect.payment.orgId,
          eventType: NOTIFICATION_EVENTS.PAYMENT_RECEIPT,
          sourceType: 'Payment',
          sourceId: effect.payment.paymentId,
          orderId: effect.payment.orderId,
          accountId: effect.payment.accountId,
          recipientScope: 'customer',
          amount: effect.payment.amount,
          currency: effect.payment.currency,
        });
      } else if (effect.kind === 'failed') {
        await this.notifications.dispatchPayment({
          orgId: effect.payment.orgId,
          eventType: NOTIFICATION_EVENTS.PAYMENT_FAILED,
          sourceType: 'Payment',
          sourceId: effect.payment.paymentId,
          orderId: effect.payment.orderId,
          recipientScope: 'customer',
          amount: effect.payment.amount,
          currency: effect.payment.currency,
        });
      } else if (effect.kind === 'dispute') {
        await this.notifications.dispatchPayment({
          orgId: effect.dispute.orgId,
          eventType: NOTIFICATION_EVENTS.PAYMENT_DISPUTE,
          sourceType: 'Dispute',
          sourceId: effect.dispute.disputeId,
          orderId: effect.dispute.orderId,
          recipientScope: 'staff',
          amount: effect.dispute.amount,
          currency: effect.dispute.currency,
          reason: effect.dispute.reason,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`post-commit side effect failed (${effect.kind}): ${reason}`);
    }
  }

  /** Best-effort org id from the event object metadata (for the ledger row only; tenancy is enforced
   *  by mapping to OUR stored rows, never by trusting the event). */
  private orgIdFromEvent(event: Stripe.Event): string | null {
    const obj = event.data.object as { metadata?: Record<string, string> | null };
    const orgId = obj?.metadata?.orgId;
    return orgId && /^[0-9a-f-]{36}$/i.test(orgId) ? orgId : null;
  }
}
