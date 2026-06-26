import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  InvoiceStatus,
  OrderStatus,
  PAYMENT_ERRORS,
  QuoteStatus,
  type GenerateInvoiceDto,
  type InvoiceLineView,
  type InvoiceView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../orders/audit.service';
import { OrderAccessService } from '../orders/order-access.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { PAYMENTS_CONFIG, type PaymentsConfig } from '../config/payments.config';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider';
import { decimalMoney, moneyToCents } from '../orders/money';
import type { PaymentSucceededEffect } from './payment.service';

interface QuoteLine {
  serviceName?: string;
  amount?: string;
  measure?: number;
  unit?: string;
}

/**
 * Invoicing + receipts (Increment 12, §8.4) — generates an Invoice (+ InvoiceLine rows) for an order
 * from its APPROVED quote (lines + the HST line), finalizes/sends via the Inc-8 engine, and produces
 * the customer receipt for a paid order. Two paths:
 *   • generateInvoice — owner/finance manual Stripe-Invoice billing (exercises the outbound seam;
 *     its live network round-trip is the deferred run). invoice.paid/payment_failed webhooks drive
 *     its state.
 *   • ensureInvoiceForPayment — auto on a webhook-confirmed PaymentIntent success: records the
 *     internal PAID invoice that IS the customer receipt (the charge already happened via the PI).
 * One Invoice per order (idempotent).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ─────────────────────────── owner/finance: generate (Stripe-invoice path) ───────────────────────────

  async generateInvoice(principal: RequestPrincipal, orderId: string, dto: GenerateInvoiceDto): Promise<InvoiceView> {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    const quote = await this.prisma.quote.findFirst({
      where: { orderId, orgId: order.orgId, status: QuoteStatus.APPROVED },
      orderBy: { approvedAt: 'desc' },
    });
    if (!quote) {
      throw new ConflictException({ error: PAYMENT_ERRORS.NO_APPROVED_QUOTE, message: 'No approved quote to invoice on this order' });
    }

    const existing = await this.prisma.invoice.findFirst({ where: { orderId, orgId: order.orgId } });
    if (existing) return this.toView(existing.id);

    const daysUntilDue = dto.dueInDays ?? this.config.invoiceDueDays;
    const lines = this.buildLines(quote);
    let invoiceId: string;
    try {
      invoiceId = await this.prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            orgId: order.orgId,
            accountId: order.accountId,
            orderId,
            number: `INV-${orderId.slice(0, 8).toUpperCase()}`,
            subtotal: decimalMoney(quote.subtotal),
            tax: decimalMoney(quote.tax),
            total: decimalMoney(quote.total),
            currency: this.config.currency,
            status: InvoiceStatus.ISSUED,
            issuedAt: new Date(),
            dueAt: new Date(Date.now() + daysUntilDue * 24 * 60 * 60 * 1000),
            lines: lines as unknown as Prisma.InputJsonValue,
            createdBy: principal.userId,
          },
        });
        for (const l of lines) {
          await tx.invoiceLine.create({
            data: { orgId: order.orgId, invoiceId: inv.id, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount },
          });
        }
        await this.audit.record(
          { orgId: order.orgId, actorId: principal.userId, entity: 'Invoice', entityId: inv.id, action: 'INVOICE_GENERATED', after: { orderId, total: decimalMoney(quote.total) } },
          tx,
        );
        return inv.id;
      });
    } catch (err) {
      // Race: a concurrent generateInvoice / the auto-receipt path won the unique (number/order) →
      // re-read + return the existing invoice (idempotent), never a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.invoice.findFirst({ where: { orderId, orgId: order.orgId } });
        if (raced) return this.toView(raced.id);
      }
      throw err;
    }

    // Outbound Stripe Invoices call (the deferred-live seam) — store the returned id so the
    // invoice.* webhooks can map back to this row. Best-effort: a provider failure must not lose our
    // already-committed invoice (the internal record is the source of truth).
    try {
      const created = await this.provider.createInvoice({
        orgId: order.orgId,
        orderId,
        accountId: order.accountId,
        currency: this.config.currency.toLowerCase(),
        lines: lines.map((l) => ({ description: l.description, amountMinor: moneyToCents(l.amount), quantity: l.quantity })),
        idempotencyKey: `inv-${invoiceId}`,
        daysUntilDue,
      });
      await this.provider.finalizeInvoice(created.id, `inv-final-${invoiceId}`);
      await this.prisma.invoice.update({ where: { id: invoiceId }, data: { stripeInvoiceId: created.id } });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Stripe invoice create deferred/failed for ${invoiceId} (internal invoice stands): ${reason}`);
    }

    return this.toView(invoiceId);
  }

  // ─────────────────────────── auto receipt on a webhook-confirmed payment ───────────────────────────

  /**
   * Create-or-mark the order's Invoice PAID (the customer receipt) when a PaymentIntent succeeds.
   * Idempotent: one Invoice per order; a re-applied success just re-confirms PAID. Runs in its own
   * short transaction (post the webhook commit) and never throws into the webhook path.
   */
  async ensureInvoiceForPayment(effect: PaymentSucceededEffect): Promise<InvoiceView | null> {
    if (!effect.orderId) return null;
    try {
      const order = await this.prisma.order.findFirst({ where: { id: effect.orderId, orgId: effect.orgId } });
      if (!order) return null;
      const quote = await this.prisma.quote.findFirst({
        where: { orderId: effect.orderId, orgId: effect.orgId, status: QuoteStatus.APPROVED },
        orderBy: { approvedAt: 'desc' },
      });
      const lines = quote ? this.buildLines(quote) : [{ description: 'Service', quantity: 1, unitAmount: effect.amount, amount: effect.amount }];
      const subtotal = quote ? decimalMoney(quote.subtotal) : effect.amount;
      const tax = quote ? decimalMoney(quote.tax) : '0.00';
      const total = quote ? decimalMoney(quote.total) : effect.amount;

      const invoiceId = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.invoice.findFirst({ where: { orderId: effect.orderId!, orgId: effect.orgId } });
        if (existing) {
          if (existing.status !== InvoiceStatus.PAID) {
            await tx.invoice.update({ where: { id: existing.id }, data: { status: InvoiceStatus.PAID, paidAt: new Date() } });
            await tx.payment.updateMany({ where: { id: effect.paymentId }, data: { invoiceId: existing.id } });
            await this.audit.record({ orgId: effect.orgId, actorId: null, entity: 'Invoice', entityId: existing.id, action: 'INVOICE_PAID', after: { via: 'payment_intent', paymentId: effect.paymentId } }, tx);
          }
          return existing.id;
        }
        const inv = await tx.invoice.create({
          data: {
            orgId: effect.orgId,
            accountId: effect.accountId ?? order.accountId,
            orderId: effect.orderId,
            number: `INV-${effect.orderId!.slice(0, 8).toUpperCase()}`,
            subtotal,
            tax,
            total,
            currency: effect.currency,
            status: InvoiceStatus.PAID,
            issuedAt: new Date(),
            paidAt: new Date(),
            lines: lines as unknown as Prisma.InputJsonValue,
          },
        });
        for (const l of lines) {
          await tx.invoiceLine.create({
            data: { orgId: effect.orgId, invoiceId: inv.id, description: l.description, quantity: l.quantity, unitAmount: l.unitAmount, amount: l.amount },
          });
        }
        await tx.payment.updateMany({ where: { id: effect.paymentId }, data: { invoiceId: inv.id } });
        await this.audit.record({ orgId: effect.orgId, actorId: null, entity: 'Invoice', entityId: inv.id, action: 'INVOICE_PAID', after: { via: 'payment_intent', paymentId: effect.paymentId, total } }, tx);
        return inv.id;
      });
      return this.toView(invoiceId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ensureInvoiceForPayment failed for order ${effect.orderId}: ${reason}`);
      return null;
    }
  }

  // ─────────────────────────── reads ───────────────────────────

  async getInvoiceForOrder(principal: RequestPrincipal, orderId: string): Promise<InvoiceView | null> {
    const order = await this.access.getOrderForRead(principal, orderId); // scope → 404 if not visible
    const inv = await this.prisma.invoice.findFirst({ where: { orderId, orgId: order.orgId }, orderBy: { createdAt: 'desc' } });
    return inv ? this.toView(inv.id) : null;
  }

  // ─────────────────────────── webhook-driven invoice transitions (inside the webhook tx) ───────────────────────────

  async applyInvoicePaid(tx: Prisma.TransactionClient, stripeInvoiceId: string): Promise<{ orgId: string; orderId: string | null; total: string } | null> {
    const inv = await tx.invoice.findFirst({ where: { stripeInvoiceId } });
    if (!inv) return null;
    if (inv.status !== InvoiceStatus.PAID) {
      await tx.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.PAID, paidAt: new Date() } });
      await this.audit.record({ orgId: inv.orgId, actorId: null, entity: 'Invoice', entityId: inv.id, action: 'INVOICE_PAID', after: { via: 'invoice.paid' } }, tx);
    }
    return { orgId: inv.orgId, orderId: inv.orderId, total: String(inv.total) };
  }

  async applyInvoicePaymentFailed(tx: Prisma.TransactionClient, stripeInvoiceId: string): Promise<{ orgId: string; orderId: string | null; total: string } | null> {
    const inv = await tx.invoice.findFirst({ where: { stripeInvoiceId } });
    if (!inv) return null;
    if (inv.status !== InvoiceStatus.PAID && inv.status !== InvoiceStatus.VOID) {
      await tx.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.OVERDUE } });
      await this.audit.record({ orgId: inv.orgId, actorId: null, entity: 'Invoice', entityId: inv.id, action: 'INVOICE_PAYMENT_FAILED', after: { via: 'invoice.payment_failed' } }, tx);
    }
    return { orgId: inv.orgId, orderId: inv.orderId, total: String(inv.total) };
  }

  // ─────────────────────────── internals ───────────────────────────

  private buildLines(quote: { lines: Prisma.JsonValue; subtotal: Prisma.Decimal; tax: Prisma.Decimal }): InvoiceLineView[] {
    const qlines = (Array.isArray(quote.lines) ? quote.lines : []) as unknown as QuoteLine[];
    const lines: InvoiceLineView[] = qlines.map((l) => ({
      description: l.serviceName ?? 'Service',
      quantity: 1,
      unitAmount: decimalMoney(l.amount ?? '0.00'),
      amount: decimalMoney(l.amount ?? '0.00'),
    }));
    if (lines.length === 0) {
      lines.push({ description: 'Service', quantity: 1, unitAmount: decimalMoney(quote.subtotal), amount: decimalMoney(quote.subtotal) });
    }
    lines.push({ description: 'HST (13%)', quantity: 1, unitAmount: decimalMoney(quote.tax), amount: decimalMoney(quote.tax) });
    return lines;
  }

  private async toView(invoiceId: string): Promise<InvoiceView> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { invoiceLines: true } });
    if (!inv) throw new NotFoundException({ error: PAYMENT_ERRORS.INVOICE_NOT_FOUND, message: `Invoice ${invoiceId} not found` });
    return {
      id: inv.id,
      orderId: inv.orderId,
      number: inv.number,
      status: inv.status as InvoiceView['status'],
      subtotal: decimalMoney(inv.subtotal),
      tax: decimalMoney(inv.tax),
      total: decimalMoney(inv.total),
      currency: inv.currency,
      lines: inv.invoiceLines.map((l) => ({ description: l.description, quantity: l.quantity, unitAmount: decimalMoney(l.unitAmount), amount: decimalMoney(l.amount) })),
      issuedAt: inv.issuedAt ? inv.issuedAt.toISOString() : null,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
    };
  }
}
