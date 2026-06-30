import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OrderStatus,
  ORDER_ERRORS,
  QuoteStatus,
  ServiceUnit,
  type ApproveQuoteDto,
  type DeclineQuoteDto,
  type QuoteBuildDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from './audit.service';
import { OrderAccessService } from './order-access.service';
import { OrdersService } from './orders.service';
import { PricingService } from './pricing.service';
import { OrderStateMachine } from './state-machine.service';
import { computeQuote, QuoteCalcError, type QuoteLineInput } from './quote-calc';

/** States from which a quote can be built (§5.1: INTAKE_INSPECTED or the damage branch). */
const QUOTABLE: OrderStatus[] = [OrderStatus.INTAKE_INSPECTED, OrderStatus.DAMAGE_PREEXISTING_FLAGGED];

/** Internal sentinel: the atomic quote claim matched 0 rows (expired-in-race or already claimed). */
class QuoteClaimLost extends Error {}

/** Derive the chargeable measure for a line from the item's measurements + the service unit. */
export function deriveMeasure(unit: string, measurements: Record<string, unknown>): number | null {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  switch (unit) {
    case ServiceUnit.SQFT: {
      const sqft = num(measurements.sqft);
      if (sqft) return sqft;
      const w = num(measurements.widthFt);
      const l = num(measurements.lengthFt);
      return w && l ? w * l : null;
    }
    case ServiceUnit.PIECE:
    case ServiceUnit.ITEM:
      return num(measurements.pieces) ?? num(measurements.count) ?? num(measurements.qty);
    case ServiceUnit.LB:
      return num(measurements.weightLb) ?? num(measurements.lb) ?? num(measurements.weight);
    default:
      return num(measurements.measure);
  }
}

@Injectable()
export class QuoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly pricing: PricingService,
    private readonly stateMachine: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  // ─────────────────────────────── build quote (→ QUOTED) ───────────────────────────────

  async build(principal: RequestPrincipal, orderId: string, dto: QuoteBuildDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    if (!QUOTABLE.includes(order.status as unknown as OrderStatus)) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Quote can be built only from INTAKE_INSPECTED/DAMAGE_PREEXISTING_FLAGGED (current: ${order.status})`,
      });
    }

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: order.orgId } });
    const taxRate = this.pricing.resolveTaxRate(org);

    const lines = await this.prisma.orderLine.findMany({
      where: { orderId, orgId: order.orgId },
      include: { item: true },
      orderBy: { createdAt: 'asc' },
    });
    const priceable = lines.filter((l) => l.serviceId && l.itemId && l.item);
    if (priceable.length === 0) {
      throw new UnprocessableEntityException({ error: ORDER_ERRORS.MEASURE_MISSING, message: 'No priceable item lines on this order' });
    }

    // Group requested upcharges by item.
    const upchargesByItem = new Map<string, { code: string; label: string; amount: number }[]>();
    for (const u of dto.upcharges) {
      const arr = upchargesByItem.get(u.itemId) ?? [];
      arr.push({ code: u.code, label: u.label, amount: u.amount });
      upchargesByItem.set(u.itemId, arr);
    }

    // [Inc-15] Price on the EFFECTIVE pricing account: the corporate account when the order matched a
    // building / a member redeemed a code (Order.pricingAccountId), else the payer's own account. The
    // payer (order.accountId) is unchanged — this only selects the rate card. resolveRate is reused as-is.
    const pricingAccountId = order.pricingAccountId ?? order.accountId;
    const inputs: QuoteLineInput[] = [];
    for (const line of priceable) {
      const measurements = (line.item!.measurements as Record<string, unknown>) ?? {};
      const resolved = await this.pricing.resolveRate(order.orgId, pricingAccountId, line.serviceId!);
      const measure = deriveMeasure(resolved.unit, measurements);
      if (measure === null) {
        throw new UnprocessableEntityException({
          error: ORDER_ERRORS.MEASURE_MISSING,
          message: `Item ${line.itemId} has no positive ${resolved.unit} measurement captured at intake`,
        });
      }
      inputs.push({
        itemId: line.itemId!,
        serviceId: line.serviceId!,
        serviceName: resolved.serviceName,
        unit: resolved.unit,
        measure,
        rate: resolved.rate,
        rateSource: resolved.source,
        upcharges: upchargesByItem.get(line.itemId!) ?? [],
      });
    }

    let computed;
    try {
      computed = computeQuote(
        inputs,
        taxRate,
        dto.manualAdjustment ? { reason: dto.manualAdjustment.reason, amount: dto.manualAdjustment.amount, actorId: principal.userId } : undefined,
      );
    } catch (err) {
      if (err instanceof QuoteCalcError) {
        throw new UnprocessableEntityException({ error: ORDER_ERRORS.MEASURE_MISSING, message: err.message });
      }
      throw err;
    }

    const expiresAt = new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000);

    const quoteId = await this.prisma.$transaction(async (tx) => {
      // Persist the finalized per-line measures/rates/amounts/upcharges.
      for (const line of priceable) {
        const c = computed.lines.find((cl) => cl.itemId === line.itemId);
        if (!c) continue;
        await tx.orderLine.update({
          where: { id: line.id },
          data: {
            measure: c.measure,
            rate: c.rate.toFixed(4),
            amount: c.amount,
            upcharges: c.upcharges as unknown as Prisma.InputJsonValue,
          },
        });
      }

      const quote = await tx.quote.create({
        data: {
          orgId: order.orgId,
          orderId,
          // PRD §9.3 Quote.lines[] — per-line breakdown (measure × rate + upcharges; each
          // amount a fixed-2 money string). Summary totals are in the Decimal columns below
          // and (formatted) in order.totals; taxRate is on order.totals.
          lines: computed.lines as unknown as Prisma.InputJsonValue,
          subtotal: computed.subtotal,
          tax: computed.tax,
          total: computed.total,
          adjustments: (computed.adjustment ? [{ ...computed.adjustment, at: new Date().toISOString() }] : []) as unknown as Prisma.InputJsonValue,
          status: QuoteStatus.SENT,
          expiresAt,
          createdBy: principal.userId,
        },
      });

      // Mirror order.totals for quick reads.
      await tx.order.update({
        where: { id: orderId },
        data: { totals: { subtotal: computed.subtotal, tax: computed.tax, total: computed.total, taxRate, currency: 'CAD' } },
      });

      // Drive to QUOTED (atomic, audited).
      await this.stateMachine.apply(tx, order, OrderStatus.QUOTED, { actorId: principal.userId, extraAudit: { quoteId: quote.id } });

      await this.audit.record(
        {
          orgId: order.orgId,
          actorId: principal.userId,
          entity: 'Quote',
          entityId: quote.id,
          action: 'QUOTE_BUILT',
          after: { subtotal: computed.subtotal, tax: computed.tax, total: computed.total, taxRate, lineCount: computed.lines.length },
        },
        tx,
      );

      // A manual adjustment is separately audited with {reason, actor, before, after} (§8.3).
      if (computed.adjustment) {
        await this.audit.record(
          {
            orgId: order.orgId,
            actorId: principal.userId,
            entity: 'Quote',
            entityId: quote.id,
            action: 'QUOTE_ADJUSTED',
            before: { subtotal: computed.adjustment.before },
            after: { subtotal: computed.adjustment.after, reason: computed.adjustment.reason, amount: computed.adjustment.amount },
          },
          tx,
        );
      }

      return quote.id;
    });

    return { order: await this.orders.getOrder(principal, orderId), quoteId };
  }

  // ─────────────────────────────── approve (→ QUOTE_APPROVED) ───────────────────────────────

  async approve(principal: RequestPrincipal, orderId: string, dto: ApproveQuoteDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    if ((order.status as unknown as OrderStatus) !== OrderStatus.QUOTED) {
      throw new ConflictException({ error: ORDER_ERRORS.ILLEGAL_TRANSITION, message: `Order is not QUOTED (current: ${order.status})` });
    }
    const quote = await this.prisma.quote.findFirst({ where: { orderId, orgId: order.orgId, status: QuoteStatus.SENT }, orderBy: { createdAt: 'desc' } });
    if (!quote) {
      throw new NotFoundException({ error: ORDER_ERRORS.QUOTE_NOT_SENT, message: 'No sent quote to approve on this order' });
    }
    // Fast-path 409 for a clearly-expired quote (friendly message + mark EXPIRED).
    if (quote.expiresAt && quote.expiresAt.getTime() < Date.now()) {
      await this.prisma.quote.updateMany({ where: { id: quote.id, status: QuoteStatus.SENT }, data: { status: QuoteStatus.EXPIRED } });
      throw new ConflictException({ error: ORDER_ERRORS.QUOTE_EXPIRED, message: 'Quote has expired; request a new quote' });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        // Atomic quote claim with an EXPIRY GUARD in the WHERE clause — closes the race
        // where a quote expires between the pre-check above and this claim. A quote that
        // expired in that window no longer matches (expiresAt > now), so it cannot be
        // approved. Concurrent approve/decline also can't both win (status = SENT guard).
        const claimed = await tx.quote.updateMany({
          where: {
            id: quote.id,
            status: QuoteStatus.SENT,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          data: { status: QuoteStatus.APPROVED, approvedBy: principal.userId, approvedAt: now },
        });
        if (claimed.count !== 1) throw new QuoteClaimLost();
        // Atomic order transition QUOTED → QUOTE_APPROVED (double-approve race → 409).
        await this.stateMachine.apply(tx, order, OrderStatus.QUOTE_APPROVED, { actorId: principal.userId, reason: dto.note, extraAudit: { quoteId: quote.id } });
        await this.audit.record(
          { orgId: order.orgId, actorId: principal.userId, entity: 'Quote', entityId: quote.id, action: 'QUOTE_APPROVED', after: { approvedBy: principal.userId, total: String(quote.total) } },
          tx,
        );
        // NOTE: payment is NOT charged here. PRD A2.2 "authorizes payment" is wired in the
        // billing increment (Stripe). Approval records state + approvedBy/approvedAt only.
      });
    } catch (err) {
      if (err instanceof QuoteClaimLost) {
        // Re-read to give a precise reason (expired in the race window vs already claimed).
        const fresh = await this.prisma.quote.findUnique({ where: { id: quote.id } });
        if (fresh && fresh.status === QuoteStatus.SENT && fresh.expiresAt && fresh.expiresAt.getTime() < Date.now()) {
          await this.prisma.quote.updateMany({ where: { id: quote.id, status: QuoteStatus.SENT }, data: { status: QuoteStatus.EXPIRED } });
          throw new ConflictException({ error: ORDER_ERRORS.QUOTE_EXPIRED, message: 'Quote has expired; request a new quote' });
        }
        throw new ConflictException({ error: ORDER_ERRORS.QUOTE_NOT_SENT, message: 'Quote was already approved/declined' });
      }
      throw err;
    }
    return this.orders.getOrder(principal, orderId);
  }

  // ─────────────────────────────── decline (→ CLOSED_NO_WORK) ───────────────────────────────

  async decline(principal: RequestPrincipal, orderId: string, dto: DeclineQuoteDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    if ((order.status as unknown as OrderStatus) !== OrderStatus.QUOTED) {
      throw new ConflictException({ error: ORDER_ERRORS.ILLEGAL_TRANSITION, message: `Order is not QUOTED (current: ${order.status})` });
    }
    const quote = await this.prisma.quote.findFirst({ where: { orderId, orgId: order.orgId, status: QuoteStatus.SENT }, orderBy: { createdAt: 'desc' } });
    if (!quote) {
      throw new NotFoundException({ error: ORDER_ERRORS.QUOTE_NOT_SENT, message: 'No sent quote to decline on this order' });
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quote.updateMany({ where: { id: quote.id, status: QuoteStatus.SENT }, data: { status: QuoteStatus.DECLINED } });
      if (claimed.count !== 1) {
        throw new ConflictException({ error: ORDER_ERRORS.QUOTE_NOT_SENT, message: 'Quote was already approved/declined' });
      }
      // QUOTED → QUOTE_DECLINED
      await this.stateMachine.apply(tx, order, OrderStatus.QUOTE_DECLINED, { actorId: principal.userId, reason: dto.reason, extraAudit: { quoteId: quote.id } });
      // Schedule the return of the items (§5.1: declined → return item → CLOSED_NO_WORK).
      if (dto.returnWindow) {
        await tx.order.update({ where: { id: orderId }, data: { scheduledDeliveryWindow: dto.returnWindow as unknown as Prisma.InputJsonValue } });
      }
      await this.audit.record(
        { orgId: order.orgId, actorId: principal.userId, entity: 'Order', entityId: orderId, action: 'RETURN_SCHEDULED', after: { returnWindow: dto.returnWindow ?? null } },
        tx,
      );
      // QUOTE_DECLINED → CLOSED_NO_WORK
      await this.stateMachine.apply(
        tx,
        { id: order.id, orgId: order.orgId, status: OrderStatus.QUOTE_DECLINED as unknown as typeof order.status, heldFrom: order.heldFrom },
        OrderStatus.CLOSED_NO_WORK,
        { actorId: principal.userId, reason: 'no work — quote declined' },
      );
    });
    return this.orders.getOrder(principal, orderId);
  }
}
