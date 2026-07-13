import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import {
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  PAYMENT_ERRORS,
  INVOICE_PORTAL_ERRORS,
  QuoteStatus,
  type CreatePaymentIntentDto,
  type PayInvoiceDto,
  type PaymentIntentResponse,
  type PaymentView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { OrderAccessService } from '../orders/order-access.service';
import { OrderStateMachine } from '../orders/state-machine.service';
import { centsToMoney, decimalMoney, moneyToCents } from '../orders/money';
import type { RequestPrincipal } from '../auth/rbac/types';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../config/payments.config';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider';
import { CreditsService } from '../credits/credits.service';

/** Order states from which a payment may NOT be taken (pre-approval or terminated without work). */
/**
 * [Inc-37] The smallest amount a card processor will accept (Stripe: 50¢ CAD). Credit is held back rather
 * than stranding a remainder below this, because such a charge would simply be rejected.
 */
const MIN_CHARGE_MINOR = 50;

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
  /** Set for an invoice-level (B2B portal) charge — the invoice this payment targets (already flipped PAID in-tx). */
  invoiceId: string | null;
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
    private readonly credits: CreditsService,
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
    const orderTotalStr = decimalMoney(quote.total);
    const orderTotalMinor = moneyToCents(orderTotalStr);
    const currency = this.config.currency;

    // Already fully paid?
    const succeeded = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED } });
    if (succeeded) {
      throw new ConflictException({ error: PAYMENT_ERRORS.ALREADY_PAID, message: 'This order has already been paid' });
    }

    /**
     * [Inc-37] APPLY THE CUSTOMER'S CREDIT before we charge a card.
     *
     * Idempotent per order (DB unique index on `[orgId, REDEMPTION, orderId]`), so a re-attempt reuses the
     * SAME redemption rather than spending the balance twice — which is why the split is computed here, once,
     * and every later path (including the pending re-attempt below) derives its charge from the actual
     * applied amount rather than recomputing against a balance that may have moved.
     */
    const applyMinor = await this.creditSplit(order.orgId, principal.userId, orderTotalMinor);
    const creditApplied = await this.credits.redeemForOrder(
      order.orgId,
      principal.userId,
      orderId,
      new Prisma.Decimal(centsToMoney(applyMinor)),
    );
    const creditMinor = moneyToCents(creditApplied.toFixed(2));
    const amountMinor = orderTotalMinor - creditMinor; // what the CARD is charged
    const amountStr = centsToMoney(amountMinor);
    const creditStr = creditApplied.toFixed(2);

    // Credit covered the ENTIRE bill → there is nothing to charge. Settle it here (no Stripe intent, no
    // client secret) with a CREDIT-method payment, and mark the order paid exactly as the webhook would.
    if (amountMinor <= 0) {
      return this.settleFromCreditOnly(principal, order, orderId, orderTotalStr, creditStr, currency);
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
      return this.intentResponse(pending.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING, creditStr, orderTotalStr);
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
      after: { orderId, amount: amountStr, creditApplied: creditStr, orderTotal: orderTotalStr, currency, intentId: intent.id, attempt: attempts + 1, provider: this.provider.name },
    });

    return this.intentResponse(payment.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING, creditStr, orderTotalStr);
  }

  /**
   * [Inc-37] How much credit we may apply to a bill of `orderTotalMinor`, in minor units.
   *
   * Capped at the live balance and at the bill — but ALSO at what Stripe can actually charge: a card charge
   * below the provider's minimum (50¢) is rejected, so we must never leave a remainder in `(0, min)`. If the
   * credit would strand such a remainder we hold back just enough that the card sees a chargeable amount, and
   * the customer keeps the difference as credit. (A bill smaller than the minimum can only be settled by
   * credit covering ALL of it — otherwise we apply none and charge the card normally.)
   */
  private async creditSplit(orgId: string, userId: string, orderTotalMinor: number): Promise<number> {
    const balance = await this.credits.balanceOf(userId, orgId);
    const balanceMinor = moneyToCents(balance.toFixed(2));
    if (balanceMinor <= 0) return 0;

    const min = MIN_CHARGE_MINOR;
    let apply = Math.min(balanceMinor, orderTotalMinor);
    const remainder = orderTotalMinor - apply;
    if (remainder === 0) return apply; // fully covered — settled without a card

    if (remainder < min) {
      // Would leave an uncharge­able stub. Hold credit back so the card sees at least the minimum…
      apply = orderTotalMinor - min;
      // …unless the bill itself is under the minimum, in which case only a FULL cover is possible.
      if (apply <= 0) return 0;
    }
    return apply;
  }

  /**
   * [Inc-37] The bill was covered entirely by credit — no card, no Stripe intent, no client secret.
   *
   * Settles the order exactly as the webhook's success path would (a SUCCEEDED Payment + the order mirrored
   * to PAID + the invoice advance), but with `method: CREDIT` so finance reporting never counts a
   * credit-settled order as card revenue. The redemption ledger entry was already written by `redeemForOrder`.
   */
  private async settleFromCreditOnly(
    principal: RequestPrincipal,
    order: { orgId: string; accountId: string },
    orderId: string,
    orderTotalStr: string,
    creditStr: string,
    currency: string,
  ): Promise<PaymentIntentResponse> {
    const payment = await this.prisma.$transaction(async (tx) => {
      // Defensive: another concurrent call may have settled it already (the redemption row is unique per
      // order, so at most one of them ever had credit to spend).
      const existing = await tx.payment.findFirst({
        where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED, method: PaymentMethod.CREDIT },
      });
      if (existing) return existing;

      const created = await tx.payment.create({
        data: {
          orgId: order.orgId,
          orderId,
          accountId: order.accountId,
          method: PaymentMethod.CREDIT,
          amount: orderTotalStr, // what this payment settled (entirely from credit)
          currency,
          status: PaymentStatus.SUCCEEDED,
          capturedAmount: orderTotalStr,
          capturedAt: new Date(),
          attempts: 1,
          createdBy: principal.userId,
        },
      });
      await this.mirrorOrderPaymentStatus(tx, order.orgId, orderId, 'PAID');
      await this.maybeAdvanceToInvoiced(tx, order.orgId, orderId);
      return created;
    });

    await this.audit.record({
      orgId: order.orgId,
      actorId: principal.userId,
      entity: 'Payment',
      entityId: payment.id,
      action: 'PAYMENT_SETTLED_FROM_CREDIT',
      after: { orderId, orderTotal: orderTotalStr, creditApplied: creditStr, charged: '0.00', currency },
    });
    this.logger.log(`order ${orderId} settled entirely from credit (${creditStr} ${currency}) — no card charged`);

    // No intent, no secret — the app must not open PaymentSheet.
    return {
      paymentId: payment.id,
      clientSecret: null,
      amount: '0.00',
      creditApplied: creditStr,
      orderTotal: orderTotalStr,
      currency,
      status: PaymentStatus.SUCCEEDED,
      publishableKey: this.config.stripe.publishableKey,
    };
  }

  // ─────────────────────────── B2B portal: pay an invoice (invoice-level) ───────────────────────────

  /**
   * Create (or re-attempt) the PaymentIntent for an INVOICE (the B2B self-serve portal). The amount is
   * ALWAYS the invoice total incl. HST, computed server-side (the body carries no money), behind the
   * same PaymentProvider seam + a deterministic idempotency key (`pi-invoice-<id>-<attempt>`) so a
   * re-attempt reuses the pending intent — never a double-charge. Returns ONLY the client secret. The
   * invoice flips to PAID exclusively on the signature-verified `payment_intent.succeeded` webhook
   * (`applyPaymentSucceeded`), never here.
   */
  async createInvoiceIntent(principal: RequestPrincipal, invoiceId: string, _dto: PayInvoiceDto): Promise<PaymentIntentResponse> {
    // Ownership + scope: 403 cross-account (same org) / 404 cross-org or nonexistent.
    const invoice = await this.requireInvoiceForPay(principal, invoiceId);

    const status = invoice.status as unknown as InvoiceStatus;
    if (status === InvoiceStatus.PAID) {
      throw new ConflictException({ error: INVOICE_PORTAL_ERRORS.ALREADY_PAID, message: `Invoice ${invoiceId} is already paid` });
    }
    if (status !== InvoiceStatus.ISSUED && status !== InvoiceStatus.OVERDUE) {
      throw new ConflictException({ error: INVOICE_PORTAL_ERRORS.NOT_PAYABLE, message: `Invoice ${invoiceId} is not payable in status ${status}` });
    }

    // Server-computed charge = the invoice total (incl. HST). Never a client amount.
    const amountStr = decimalMoney(invoice.total);
    const amountMinor = moneyToCents(amountStr);
    const currency = invoice.currency || this.config.currency;

    // Decide the single Payment row to drive — SERIALIZED per invoice via a row lock so two concurrent
    // pay attempts can never create two PENDING payments / two Stripe intents (a double-charge window).
    // The lock + the deterministic per-invoice idempotency key together guarantee at-most-one intent.
    const decision = await this.prisma.$transaction(async (tx) => {
      // Lock THIS invoice row (tx does not inherit the scoped extension → pin orgId explicitly).
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId}::uuid AND org_id = ${invoice.orgId}::uuid FOR UPDATE`;

      // Already settled by a SUCCEEDED payment? (defensive — the status guard above also covers PAID.)
      const succeeded = await tx.payment.findFirst({ where: { invoiceId, orgId: invoice.orgId, status: PaymentStatus.SUCCEEDED } });
      if (succeeded) {
        throw new ConflictException({ error: INVOICE_PORTAL_ERRORS.ALREADY_PAID, message: `Invoice ${invoiceId} is already paid` });
      }

      // Re-attempt: a pending intent already exists → reuse it (no second intent).
      const pending = await tx.payment.findFirst({ where: { invoiceId, orgId: invoice.orgId, status: PaymentStatus.PENDING }, orderBy: { createdAt: 'desc' } });
      if (pending && pending.idempotencyKey) {
        return { reuse: true as const, payment: pending };
      }

      // New attempt — bounded by the dunning retry cap. The count runs under the row lock, so the
      // attempt number (→ the idempotency key) is consistent even under concurrency.
      const attempts = await tx.payment.count({ where: { invoiceId, orgId: invoice.orgId } });
      if (attempts >= this.config.maxPaymentAttempts) {
        throw new ConflictException({ error: PAYMENT_ERRORS.RETRY_LIMIT_REACHED, message: 'Payment retry limit reached; please contact support' });
      }
      const created = await tx.payment.create({
        data: {
          orgId: invoice.orgId,
          invoiceId,
          accountId: invoice.accountId,
          amount: amountStr,
          currency,
          status: PaymentStatus.PENDING,
          captureMethod: this.captureMethod(),
          idempotencyKey: `pi-invoice-${invoiceId}-${attempts + 1}`,
          attempts: attempts + 1,
          createdBy: principal.userId,
        },
      });
      return { reuse: false as const, payment: created };
    });

    const payment = decision.payment;
    const idempotencyKey = payment.idempotencyKey as string;

    // Create the intent OUTSIDE the lock — the deterministic key means a reuse re-calls the provider
    // with the SAME key, so Stripe returns the identical intent + client secret (no double-charge).
    let intent;
    try {
      intent = await this.provider.createPaymentIntent({
        amountMinor,
        currency: currency.toLowerCase(),
        invoiceId,
        orgId: invoice.orgId,
        accountId: invoice.accountId,
        idempotencyKey,
        captureMethod: this.captureMethod(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!decision.reuse) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, lastError: reason } });
      }
      throw new UnprocessableEntityException({ error: INVOICE_PORTAL_ERRORS.NOT_PAYABLE, message: `Could not start payment: ${reason}` });
    }

    if (payment.stripePaymentIntentId !== intent.id) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id } });
    }
    if (!decision.reuse) {
      await this.audit.record({
        orgId: invoice.orgId,
        actorId: principal.userId,
        entity: 'Payment',
        entityId: payment.id,
        action: 'PAYMENT_INTENT_CREATED',
        after: { invoiceId, amount: amountStr, currency, intentId: intent.id, attempt: payment.attempts, provider: this.provider.name },
      });
    }

    return this.intentResponse(payment.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING);
  }

  /** The invoice's current payment (latest), scoped to the caller — the portal polls this. Null when none. */
  async getPaymentForInvoice(principal: RequestPrincipal, invoiceId: string): Promise<PaymentView | null> {
    const invoice = await this.requireInvoiceForRead(principal, invoiceId); // scope → 404 if not visible
    const p = await this.prisma.payment.findFirst({ where: { invoiceId, orgId: invoice.orgId }, orderBy: { createdAt: 'desc' } });
    return p ? toPaymentView(p) : null;
  }

  /** Pay-gate: scoped read → 403 cross-account (same org), 404 cross-org/nonexistent (no existence leak). */
  private async requireInvoiceForPay(principal: RequestPrincipal, invoiceId: string) {
    const scoped = await scopedPrisma(this.prisma, principal).invoice.findFirst({ where: { id: invoiceId } });
    if (scoped) return scoped;
    const inOrg = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId: principal.orgId } });
    if (inOrg) throw new ForbiddenException({ error: INVOICE_PORTAL_ERRORS.CROSS_ACCOUNT_FORBIDDEN, message: 'Invoice belongs to a different account in your organization' });
    throw new NotFoundException({ error: INVOICE_PORTAL_ERRORS.INVOICE_NOT_FOUND, message: `Invoice ${invoiceId} not found` });
  }

  /** Read-gate: scoped read → 404 (no 403/existence leak on pure reads, per the codebase convention). */
  private async requireInvoiceForRead(principal: RequestPrincipal, invoiceId: string) {
    const inv = await scopedPrisma(this.prisma, principal).invoice.findFirst({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException({ error: INVOICE_PORTAL_ERRORS.INVOICE_NOT_FOUND, message: `Invoice ${invoiceId} not found` });
    return inv;
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
    if (payment.invoiceId) {
      // Invoice-level pay (B2B portal): the targeted invoice IS the receipt. Flip it to PAID in-tx
      // (the source of truth), scoped explicitly by orgId (the tx client does not inherit row-scoping).
      // Money guard: only flip PAID when the webhook-captured amount covers the SERVER-computed charge
      // (the invoice total) — an underpayment/partial capture must NOT silently mark the invoice paid.
      const expectedMinor = moneyToCents(String(payment.amount));
      if (capturedMinor < expectedMinor) {
        await this.audit.record(
          { orgId: payment.orgId, actorId: null, entity: 'Invoice', entityId: payment.invoiceId, action: 'INVOICE_PAYMENT_UNDERPAID', after: { paymentId: payment.id, captured: centsToMoney(capturedMinor), expected: centsToMoney(expectedMinor) } },
          tx,
        );
        this.logger.warn(`invoice ${payment.invoiceId}: captured ${centsToMoney(capturedMinor)} < expected ${centsToMoney(expectedMinor)} — payment SUCCEEDED but invoice NOT marked PAID`);
      } else {
        const inv = await tx.invoice.findFirst({ where: { id: payment.invoiceId, orgId: payment.orgId } });
        if (inv && inv.status !== InvoiceStatus.PAID && inv.status !== InvoiceStatus.VOID) {
          await tx.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.PAID, paidAt: new Date() } });
          await this.audit.record(
            { orgId: payment.orgId, actorId: null, entity: 'Invoice', entityId: inv.id, action: 'INVOICE_PAID', after: { via: 'payment_intent', paymentId: payment.id } },
            tx,
          );
        }
      }
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

  private toSucceededEffect(p: { id: string; orgId: string; orderId: string | null; invoiceId: string | null; accountId: string | null; capturedAmount: Prisma.Decimal | string; amount: Prisma.Decimal | string; currency: string }): PaymentSucceededEffect {
    return { paymentId: p.id, orgId: p.orgId, orderId: p.orderId, invoiceId: p.invoiceId, accountId: p.accountId, amount: decimalMoney(p.amount), currency: p.currency };
  }
  private toFailedEffect(p: { id: string; orgId: string; orderId: string | null; amount: Prisma.Decimal | string; currency: string }, _err: string | null): PaymentFailedEffect {
    return { paymentId: p.id, orgId: p.orgId, orderId: p.orderId, amount: decimalMoney(p.amount), currency: p.currency };
  }

  /**
   * [Inc-37] `creditApplied`/`orderTotal` default to the no-credit case, which is exactly right for the B2B
   * INVOICE path (customer credit is a consumer-order concept and is never applied to a business invoice).
   */
  private intentResponse(
    paymentId: string,
    clientSecret: string,
    amount: string,
    currency: string,
    status: PaymentStatus,
    creditApplied = '0.00',
    orderTotal = amount,
  ): PaymentIntentResponse {
    return { paymentId, clientSecret, amount, creditApplied, orderTotal, currency, status, publishableKey: this.config.stripe.publishableKey };
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
