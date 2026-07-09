import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Order } from '@prisma/client';
import {
  OrderStatus,
  ORDER_ERRORS,
  PricingModel,
  RoleScope,
  RoleType,
  WeighPoint,
  type CaptureWeightDto,
  type OrderWeightView,
  type WeightCaptureResult,
  type WeightCaptureView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import { AuditService } from './audit.service';
import { OrderAccessService } from './order-access.service';
import { QuoteService } from './quote.service';

/**
 * Order states from which the pricing gate (re)prices (§5.1 — mirrors QuoteService.QUOTABLE). Includes
 * QUOTE_APPROVED for the Inc-23 P5 re-quote branch: a plant re-weigh after approval re-opens the quote
 * (QUOTE_APPROVED → QUOTED) and re-prices (FIXED auto-re-approves; FROM_MEASURED re-opens for approval).
 */
const QUOTABLE: OrderStatus[] = [OrderStatus.INTAKE_INSPECTED, OrderStatus.DAMAGE_PREEXISTING_FLAGGED, OrderStatus.QUOTE_APPROVED];

/**
 * [Inc-22] Weight → price. A driver/plant approves an actual weight; this writes an APPEND-ONLY
 * `WeightCapture` (never mutated — a correction is a new capture; authoritative = the most recent),
 * denormalizes it onto the item's measurements so the existing quote engine reads it, then runs the
 * HYBRID PRICING GATE and emits the live push:
 *   • all-FIXED order  → build the quote (measure × published rate + min-order floor) and AUTO-APPROVE it
 *     with an audit note ("auto-priced at published rate") → INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED.
 *   • any FROM_MEASURED specialty line → build the quote SENT and STOP; the customer approves/declines in
 *     the existing OrderDetail quote card. Mixed orders price the FIXED lines but wait on the specialty.
 * No new lifecycle statuses; reuses OrderStateMachine + QuoteService verbatim.
 *
 * TODO (deferred, needs a re-quote flow): re-pricing after QUOTE_APPROVED — a plant re-weigh currently
 * records the new authoritative weight + audits the switch, but does NOT re-open an already-approved quote
 * (§5.1 has no QUOTE_APPROVED → INTAKE_INSPECTED edge; a REWASH-style re-quote branch would be needed).
 */
@Injectable()
export class WeighService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly quotes: QuoteService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Order-scoped entry (staff/org-wide): authorize the order for write, then run the core. */
  async weigh(principal: RequestPrincipal, orderId: string, dto: CaptureWeightDto): Promise<WeightCaptureResult> {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    return this.weighForOrder(principal, order, dto);
  }

  /**
   * The weigh core (append-only capture → denormalize → hybrid pricing gate → live push). The `order` is
   * ALREADY authorized by the caller — order-scoped staff via `requireOrderForWrite`, OR a driver via stop
   * ownership (DriverService.weighLoad). The append-only capture is attributed to the real weigher
   * (`principal.userId`); the pricing gate (build/approve need org-write) runs with an ORG-SYSTEM principal
   * so a driver's approved weight still prices — the price is a system rule, decoupled from actor scope,
   * and every write it makes is audited to the real weigher.
   */
  async weighForOrder(principal: RequestPrincipal, order: Order, dto: CaptureWeightDto): Promise<WeightCaptureResult> {
    const orgId = order.orgId;
    const orderId = order.id;
    const targetItemId = await this.resolveTargetItem(orgId, orderId, dto.itemId);

    // Prior authoritative weight for this order/item (for the audited "switch" when a re-weigh corrects it).
    const prior = await this.prisma.weightCapture.findFirst({
      where: { orgId, orderId, ...(targetItemId ? { itemId: targetItemId } : {}) },
      orderBy: { capturedAt: 'desc' },
    });

    const weightStr = dto.weightKg.toFixed(2);

    // 1) Append-only capture + denormalize the weight onto the item's measurements (the quote engine reads
    //    Item.measurements.weightKg for a KG-unit service). The WeightCapture row is immutable; the item
    //    measurements bag is the mutable current-measure (the intake pattern).
    const capture = await this.prisma.$transaction(async (tx) => {
      const cap = await tx.weightCapture.create({
        data: {
          orgId,
          orderId,
          itemId: targetItemId,
          weightKg: new Prisma.Decimal(weightStr),
          weighPoint: dto.weighPoint,
          capturedByUserId: principal.userId,
          source: dto.source ?? 'driver',
          note: dto.note ?? null,
          createdBy: principal.userId,
        },
      });

      if (targetItemId) {
        const item = await tx.item.findFirst({ where: { id: targetItemId, orgId }, select: { measurements: true } });
        const measurements = ((item?.measurements as Record<string, unknown>) ?? {}) as Record<string, unknown>;
        await tx.item.update({
          where: { id: targetItemId },
          data: { measurements: { ...measurements, weightKg: dto.weightKg } as Prisma.InputJsonValue },
        });
      }

      await this.audit.record(
        {
          orgId,
          actorId: principal.userId,
          entity: 'WeightCapture',
          entityId: cap.id,
          action: prior ? 'WEIGHT_RECAPTURED' : 'WEIGHT_CAPTURED',
          ...(prior ? { before: { priorWeightKg: prior.weightKg.toFixed(2), priorWeighPoint: prior.weighPoint } } : {}),
          after: { weightKg: weightStr, weighPoint: dto.weighPoint, itemId: targetItemId, source: dto.source ?? 'driver' },
        },
        tx,
      );
      return cap;
    });

    // 2) Hybrid pricing gate (only when the order is quotable — a pickup weigh before intake just records it).
    //    Runs with an org-system principal so a driver's weigh can trigger the auto-price (system rule).
    const pricing = await this.runPricingGate(this.systemPrincipal(order, principal.userId), orderId, orgId, order.status as unknown as OrderStatus);

    // 3) Live push to the dashboard (FLEET) + the order's customer (ORDER room). REST stays source of truth.
    this.realtime.publishWeight(orgId, orderId, {
      orderId,
      itemId: targetItemId,
      weightKg: weightStr,
      weighPoint: dto.weighPoint,
      authoritativeWeightKg: weightStr,
      capturedAt: capture.capturedAt.toISOString(),
      pricingStatus: pricing.status,
      priceTotal: pricing.total,
      currency: pricing.currency,
    });

    return { capture: toCaptureView(capture), authoritativeWeightKg: weightStr, pricing };
  }

  /** The authoritative weight (most recent capture) + the full append-only history for an order (staff read). */
  async getOrderWeight(principal: RequestPrincipal, orderId: string): Promise<OrderWeightView> {
    const order = await this.access.getOrderForRead(principal, orderId);
    return this.weightViewForOrder(order);
  }

  /** The weight view for an ALREADY-authorized order (order-scoped read OR driver stop-scoped read). */
  async weightViewForOrder(order: Pick<Order, 'id' | 'orgId'>): Promise<OrderWeightView> {
    const captures = await this.prisma.weightCapture.findMany({
      where: { orgId: order.orgId, orderId: order.id },
      orderBy: { capturedAt: 'desc' },
    });
    const authoritative = captures[0] ?? null;
    // Customer booking estimate = the order's total estimated measure (OrderLine.measure at book time,
    // before the quote overwrites it). Null when none was given / already priced away.
    const lines = await this.prisma.orderLine.findMany({ where: { orderId: order.id, orgId: order.orgId }, select: { measure: true } });
    const estimate = lines.reduce((sum, l) => sum + (l.measure ?? 0), 0);
    return {
      orderId: order.id,
      authoritativeWeightKg: authoritative ? authoritative.weightKg.toFixed(2) : null,
      authoritativeWeighPoint: authoritative ? (authoritative.weighPoint as unknown as WeighPoint) : null,
      captures: captures.map(toCaptureView),
      customerEstimate: estimate > 0 ? estimate : null,
    };
  }

  // ─────────────────────────── internals ───────────────────────────

  /**
   * An org-wide system principal for the pricing gate (build/approve require org-write). `userId` stays the
   * REAL weigher so every audited write attributes correctly; the org-wide role only widens row scope so a
   * driver's approved weight can auto-price. Never leaves the server (not a token, no jti/exp of value).
   */
  private systemPrincipal(order: Pick<Order, 'orgId'>, actorUserId: string | null): RequestPrincipal {
    return {
      userId: actorUserId ?? '',
      orgId: order.orgId,
      roles: [{ role: RoleType.OWNER, scope: RoleScope.ORG, scopeId: null }],
      accountIds: [],
      siteIds: [],
      jti: 'system-weigh',
      accessExp: 0,
    };
  }

  private async resolveTargetItem(orgId: string, orderId: string, itemId?: string): Promise<string | null> {
    if (itemId) {
      const item = await this.prisma.item.findFirst({ where: { id: itemId, orderId, orgId }, select: { id: true } });
      if (!item) throw new NotFoundException({ error: ORDER_ERRORS.ITEM_NOT_FOUND, message: `item ${itemId} not found on order ${orderId}` });
      return itemId;
    }
    const items = await this.prisma.item.findMany({ where: { orderId, orgId }, select: { id: true } });
    if (items.length === 1) return items[0].id;
    if (items.length === 0) return null; // order-level capture (no item to attach; pricing prices existing lines)
    throw new BadRequestException({ error: ORDER_ERRORS.WEIGH_ITEM_AMBIGUOUS, message: `order ${orderId} has ${items.length} items — pass itemId to target the weighed one` });
  }

  private async runPricingGate(
    principal: RequestPrincipal,
    orderId: string,
    orgId: string,
    currentStatus: OrderStatus,
  ): Promise<WeightCaptureResult['pricing']> {
    if (!QUOTABLE.includes(currentStatus)) {
      // Weighed outside a quotable state (e.g. a pickup weigh before intake, or once cleaning has begun) —
      // the weight is recorded; pricing runs when the order is inspected. Never silently re-price.
      return { status: 'none', total: null, currency: 'CAD', awaitsCustomerApproval: false, orderStatus: currentStatus };
    }

    // [Inc-23 P5] A re-weigh of an already-APPROVED order re-opens the quote (QUOTE_APPROVED → QUOTED) and
    // re-prices; the audit note distinguishes it from the initial auto-price.
    const isRequote = currentStatus === OrderStatus.QUOTE_APPROVED;

    let quoteId: string;
    try {
      const built = await this.quotes.build(principal, orderId, { upcharges: [], expiresInDays: 14 });
      quoteId = built.quoteId;
    } catch (err) {
      // A line still missing its measure (e.g. a specialty item not yet measured) → 422 bubbles up. Honest:
      // we can't price the order until every priceable line has a measure.
      throw err;
    }

    const quote = await this.prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { total: true } });
    const total = quote.total.toFixed(2);
    const hasFromMeasured = await this.orderHasFromMeasuredLine(orgId, orderId);

    if (!hasFromMeasured) {
      // All FIXED → auto-approve at the published rate (customer sees the price; no approval tap required).
      await this.quotes.approve(principal, orderId, { note: isRequote ? 're-priced on plant re-weigh' : 'auto-priced at published rate' });
      return { status: 'auto_approved', total, currency: 'CAD', awaitsCustomerApproval: false, orderStatus: OrderStatus.QUOTE_APPROVED };
    }
    // A FROM_MEASURED specialty line is present → the quote is SENT; the customer (re-)approves/declines.
    return { status: 'quote_sent', total, currency: 'CAD', awaitsCustomerApproval: true, orderStatus: OrderStatus.QUOTED };
  }

  /** True if any of the order's priceable services is a FROM_MEASURED specialty (via its catalog card). */
  private async orderHasFromMeasuredLine(orgId: string, orderId: string): Promise<boolean> {
    const lines = await this.prisma.orderLine.findMany({ where: { orderId, orgId }, select: { serviceId: true } });
    const serviceIds = lines.map((l) => l.serviceId).filter((v): v is string => !!v);
    if (serviceIds.length === 0) return false;
    const services = await this.prisma.service.findMany({
      where: { id: { in: serviceIds }, orgId },
      select: { category: { select: { pricingModel: true } } },
    });
    return services.some((s) => s.category?.pricingModel === PricingModel.FROM_MEASURED);
  }
}

function toCaptureView(c: {
  id: string;
  orderId: string;
  itemId: string | null;
  weightKg: Prisma.Decimal;
  weighPoint: string;
  capturedByUserId: string | null;
  capturedAt: Date;
  source: string | null;
  note: string | null;
}): WeightCaptureView {
  return {
    id: c.id,
    orderId: c.orderId,
    itemId: c.itemId,
    weightKg: c.weightKg.toFixed(2),
    weighPoint: c.weighPoint as unknown as WeighPoint,
    capturedByUserId: c.capturedByUserId,
    capturedAt: c.capturedAt.toISOString(),
    source: c.source,
    note: c.note,
  };
}
