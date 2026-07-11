import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  ItemStatus,
  OrderStatus,
  OrderType,
  OrderVertical,
  ORDER_ERRORS,
  TagBinding,
  TagType,
  ZONE_ERRORS,
  type BookOrderDto,
  type HoldOrderDto,
  type ListOrdersQuery,
  type ResumeOrderDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isOrgWide } from '../auth/rbac/policy';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from './audit.service';
import { ITEM_ORDER_BY } from './item-order';
import { MediaSigner } from '../media/storage/media-signer';
import { OrderAccessService } from './order-access.service';
import { PricingService } from './pricing.service';
import { PricingAccountService } from './pricing-account.service';
import { OrderStateMachine } from './state-machine.service';
import { ServiceZonesService } from '../service-zones/service-zones.service';
import { roundCents, centsToMoney } from './money';

/** The photo columns the order read selects (for signing without leaking the raw key). */
type PhotoRow = {
  id: string;
  kind: string;
  contentType: string | null;
  sizeBytes: number | null;
  takenAt: Date;
  createdAt: Date;
  storageKey: string | null;
  url: string | null;
};

const FULL_INCLUDE = {
  // [Inc-16] Thin, read-only: the corporate account that PRICES this order (Inc-15's effective pricing
  // account), so the customer app can show "Corporate pricing — [name]" from server truth. The scalar
  // `pricingAccountId` already flows; this only adds the name. NULL ⇒ priced on the payer's own account.
  // No pricing logic — display only; the order's owner reads their OWN order (scope already enforced).
  pricingAccount: { select: { name: true } },
  // [Inc-29] `createdAt` alone is not a total order: Prisma stamps it per statement, so lines written inside
  // one booking transaction can share a millisecond. The `id` tiebreak makes the sequence deterministic —
  // the same order on every read — rather than leaving the tail to heap order.
  lines: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  // [Inc-29] THE fix. Without an `orderBy`, Postgres returned an order's items in heap order, and an UPDATE
  // (an intake inspection, a plant weigh) relocates a row — so two reads of the same order listed its items
  // differently, on the customer app, the console and the driver's manifest alike. See `ITEM_ORDER_BY`.
  items: {
    orderBy: ITEM_ORDER_BY,
    include: {
      tag: true,
      inspections: { orderBy: { createdAt: 'asc' as const } },
      photos: { orderBy: { takenAt: 'asc' as const } },
      custodyEvents: { orderBy: { occurredAt: 'asc' as const } },
    },
  },
  quotes: { orderBy: { createdAt: 'desc' as const } },
  // Increment 4: the order's route stops (status/eta) — the "track my truck" data, surfaced
  // here so a customer reading their own order sees its pickup stop's progress (row-scoped).
  routeStops: { orderBy: { createdAt: 'asc' as const }, select: { id: true, kind: true, seq: true, status: true, eta: true, arrivedAt: true, completedAt: true, routeId: true } },
  // [Inc-32] The order's post-delivery rating (or null) — so the customer app's OrderDetail can show the
  // "Rate this order" CTA (delivered-and-unrated) or the submitted score read-only in one round-trip.
  rating: true,
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly pricing: PricingService,
    private readonly pricingAccount: PricingAccountService,
    private readonly stateMachine: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly signer: MediaSigner,
    private readonly serviceZones: ServiceZonesService,
  ) {}

  // ─────────────────────────────── book (REQUESTED) ───────────────────────────────

  async book(principal: RequestPrincipal, dto: BookOrderDto) {
    const orgId = principal.orgId;
    const orgWide = isOrgWide(principal.roles);

    // Horizontal scope: a confined customer may only book for their own account.
    if (!orgWide && !principal.accountIds.includes(dto.accountId)) {
      throw new ForbiddenException({
        error: ORDER_ERRORS.CROSS_ACCOUNT_FORBIDDEN,
        message: 'You may only book orders for your own account',
      });
    }

    // Account must exist in the principal's org.
    const account = await this.prisma.account.findFirst({ where: { id: dto.accountId, orgId } });
    if (!account) {
      throw new NotFoundException({ error: ORDER_ERRORS.INVALID_BOOKING, message: 'Account not found in your organization' });
    }

    // Site (optional) must belong to that account + org, and still be ACTIVE. Kept in scope so a geo-blocked
    // booking can snapshot the site's address onto the CoverageRequest (the honest demand signal).
    // [Inc-26] `active: true` — a saved address the customer removed is soft-deleted, not gone (past orders
    // reference it). Without this filter a stale client could keep booking pickups at a deleted address.
    let site: { address: string | null } | null = null;
    if (dto.siteId) {
      site = await this.prisma.site.findFirst({
        where: { id: dto.siteId, orgId, accountId: dto.accountId, active: true },
        select: { address: true },
      });
      if (!site) {
        throw new BadRequestException({ error: ORDER_ERRORS.INVALID_BOOKING, message: 'Site does not belong to the account' });
      }
    }

    // Validate services exist in org and pre-resolve rates for the estimate range.
    const serviceIds = [...new Set(dto.items.map((i) => i.serviceId))];
    const services = await this.prisma.service.findMany({ where: { id: { in: serviceIds }, orgId } });
    const known = new Set(services.map((s) => s.id));
    const missing = serviceIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw new BadRequestException({ error: ORDER_ERRORS.INVALID_BOOKING, message: `Unknown service(s): ${missing.join(', ')}` });
    }

    // [Inc-15] Resolve the EFFECTIVE PRICING ACCOUNT (building match → membership → none). The payer
    // stays dto.accountId; this only selects which rate card prices the order. A corporate building the
    // service point falls in, or the booker's corporate membership, prices the order on that account —
    // while the member still pays individually (PER_ORDER). No match ⇒ default/residential pricing.
    const effective = await this.pricingAccount.resolveForBooking({
      orgId,
      userId: principal.userId,
      payerAccountId: dto.accountId,
      serviceGeo: dto.serviceGeo,
    });
    const pricingAccountId = effective?.pricingAccountId ?? dto.accountId;

    // [Inc-19] Geo-blocking gate. Block a booking whose service point falls outside every ACTIVE service zone
    // and capture the address as demand — UNLESS the order is a serviced corporate order (building match OR
    // active membership → `effective`) or the payer is itself a corporate account (an explicit service
    // commitment is never geo-blocked; this also covers the self-match case where resolveForBooking returns
    // null because the match equals the payer). The gate only evaluates when a service point is supplied AND
    // the org has drawn active zones (no point ⇒ nothing to test, mirroring building-match's `if (serviceGeo)`;
    // no active zones ⇒ the org serves everywhere). The SERVER is authoritative — a client hint never bypasses
    // it. Runs BEFORE the order transaction so a blocked booking never creates an order row (gates creation
    // only; never mutates status/lifecycle/pricing — PRD §5.1).
    const corporate = effective !== null || account.corporate === true;
    if (!corporate && dto.serviceGeo) {
      const { hasActiveZones, covered } = await this.serviceZones.isServiceable(orgId, dto.serviceGeo);
      if (hasActiveZones && !covered) {
        // Capture the demand FIRST (its own commit); only then reject. If the capture throws, no 422 is
        // returned and no CoverageRequest exists — the app never claims "listed" on a failed write (lens 5).
        await this.serviceZones.captureCoverageRequest({
          orgId,
          userId: principal.userId,
          point: dto.serviceGeo,
          address: site?.address ?? null,
          context: { accountId: dto.accountId, siteId: dto.siteId ?? null },
        });
        throw new UnprocessableEntityException({
          error: ZONE_ERRORS.OUT_OF_SERVICE_AREA,
          message: 'This address is outside our current service area',
        });
      }
    }

    // Pre-resolve rates and build a rough estimate range (PRD §7A A2.1 — pre-intake), on the effective
    // pricing account so the pre-intake estimate already reflects corporate pricing.
    const rateByService = new Map<string, number>();
    for (const id of serviceIds) {
      const r = await this.pricing.resolveRate(orgId, pricingAccountId, id);
      rateByService.set(id, r.rate);
    }
    let estimateCents = 0;
    let estimatableCount = 0;
    for (const item of dto.items) {
      if (item.estimatedMeasure && item.estimatedMeasure > 0) {
        estimateCents += roundCents(item.estimatedMeasure * (rateByService.get(item.serviceId) ?? 0));
        estimatableCount += 1;
      }
    }
    const estimateRange =
      estimatableCount > 0
        ? {
            low: centsToMoney(roundCents((estimateCents / 100) * 0.9)),
            high: centsToMoney(roundCents((estimateCents / 100) * 1.15)),
            currency: 'CAD',
            basis: 'pre-intake rough estimate; final quote after measurement',
          }
        : null;

    const orderId = randomUUID();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: orderId,
            orgId,
            accountId: dto.accountId,
            // [Inc-15] Only set when pricing differs from the payer (a corporate building/membership
            // match); null ⇒ priced on the payer's own account. Never equals accountId (guarded upstream).
            pricingAccountId: effective?.pricingAccountId ?? null,
            siteId: dto.siteId ?? null,
            vertical: OrderVertical.SPECIALTY,
            type: OrderType.JOB,
            status: OrderStatus.REQUESTED,
            scheduledPickupWindow: dto.pickupWindow ?? Prisma.JsonNull,
            totals: {
              ...(estimateRange ? { estimateRange } : {}),
              currency: 'CAD',
              ...(dto.notes ? { notes: dto.notes } : {}),
            },
            createdBy: principal.userId,
          },
        });

        // [Inc-29] `sortOrder` is the item's index in the SUBMITTED array — the sequence the customer composed
        // them in, which is the only ordering anyone ever intended. It is written once, here; an item's
        // `orderId` is never reassigned afterwards, so the value stays correct for the life of the row.
        for (const [sortOrder, item] of dto.items.entries()) {
          const tag = await tx.tag.create({
            data: {
              orgId,
              code: item.tagCode ?? `BB-${randomUUID().slice(0, 8).toUpperCase()}`,
              type: TagType.QR,
              boundTo: TagBinding.ITEM,
              active: true,
              createdBy: principal.userId,
            },
          });
          const createdItem = await tx.item.create({
            data: {
              orgId,
              orderId,
              tagId: tag.id,
              kind: item.kind,
              status: ItemStatus.RECEIVED,
              sortOrder,
              measurements: (item.measurements ?? {}) as Prisma.InputJsonValue,
              createdBy: principal.userId,
            },
          });
          const measure = item.estimatedMeasure ?? null;
          const rate = rateByService.get(item.serviceId) ?? 0;
          const lineCents = measure ? roundCents(measure * rate) : 0;
          await tx.orderLine.create({
            data: {
              orgId,
              orderId,
              itemId: createdItem.id,
              serviceId: item.serviceId,
              qty: 1,
              measure,
              rate: rate.toFixed(4),
              amount: centsToMoney(lineCents),
              upcharges: [],
              createdBy: principal.userId,
            },
          });
        }

        await this.audit.record(
          {
            orgId,
            actorId: principal.userId,
            entity: 'Order',
            entityId: orderId,
            action: 'ORDER_BOOKED',
            after: {
              status: OrderStatus.REQUESTED,
              accountId: dto.accountId,
              pricingAccountId: effective?.pricingAccountId ?? null,
              pricingSource: effective?.source ?? null,
              itemCount: dto.items.length,
              estimateRange,
            },
          },
          tx,
        );
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: ORDER_ERRORS.INVALID_BOOKING, message: 'A supplied tag code is already in use' });
      }
      throw err;
    }

    return this.getOrder(principal, orderId);
  }

  // ─────────────────────────────── read / list ───────────────────────────────

  /** Detailed order read (scoped). 404 if not visible to the principal. */
  async getOrder(principal: RequestPrincipal, orderId: string) {
    await this.access.getOrderForRead(principal, orderId); // enforces scope → 404 if not visible
    // Re-read with full graph through the scoped client (parent scope already proven).
    const order = await this.access
      .scopedFor(principal)
      .order.findUnique({ where: { id: orderId }, include: FULL_INCLUDE });
    if (!order) {
      throw new NotFoundException({ error: ORDER_ERRORS.ORDER_NOT_FOUND, message: `Order ${orderId} not found` });
    }
    return this.signOrderPhotos(order);
  }

  /**
   * Replace each item-photo's stored object KEY with a freshly-minted short-lived signed GET URL
   * (§14) — and DON'T leak the raw key/internal columns to the client. Newly-uploaded photos
   * (storageKey) get a presigned GET; legacy external-reference photos (url) return that url.
   */
  private async signOrderPhotos<O extends { items: Array<{ photos: PhotoRow[] }> }>(order: O): Promise<O> {
    for (const item of order.items) {
      const signed = await Promise.all(
        item.photos.map(async (p) => ({
          id: p.id,
          kind: p.kind,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          takenAt: p.takenAt,
          createdAt: p.createdAt,
          downloadUrl: await this.signer.signedGet(p),
        })),
      );
      (item as { photos: unknown }).photos = signed;
    }
    return order;
  }

  /** Cursor-paginated, row-scoped order list (PRD §11.1 — cursor pagination). */
  async listOrders(principal: RequestPrincipal, query: ListOrdersQuery) {
    const db = this.access.scopedFor(principal);
    // Additive filters AND-merged on top of the unforgettable row-scope: status and (Track-A B2B
    // portal) an optional single-account confinement. Cross-tenant is still impossible — the scoped
    // client pins org (+ account for confined principals); accountId only narrows further.
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status as unknown as Prisma.OrderWhereInput['status'] } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
    };
    const rows = await db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      // [Inc-32] `rating` so the customer Orders list can show a delivered order's score (or the Rate CTA)
      // without a per-row fetch. Additive; other consumers (console list) simply ignore the extra field.
      include: { quotes: { orderBy: { createdAt: 'desc' }, take: 1 }, rating: true },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      orders: page,
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
    };
  }

  // ─────────────────────────────── ON_HOLD / resume ───────────────────────────────

  async hold(principal: RequestPrincipal, orderId: string, dto: HoldOrderDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.apply(tx, order, OrderStatus.ON_HOLD, { actorId: principal.userId, reason: dto.reason });
    });
    return this.getOrder(principal, orderId);
  }

  async resume(principal: RequestPrincipal, orderId: string, _dto: ResumeOrderDto) {
    const order = await this.access.requireOrderForWrite(principal, orderId);
    if ((order.status as unknown as OrderStatus) !== OrderStatus.ON_HOLD) {
      throw new ConflictException({
        error: ORDER_ERRORS.ILLEGAL_TRANSITION,
        message: `Order is not ON_HOLD (current: ${order.status})`,
      });
    }
    const heldFrom = order.heldFrom as unknown as OrderStatus | null;
    if (!heldFrom) {
      throw new ConflictException({ error: ORDER_ERRORS.ILLEGAL_TRANSITION, message: 'Order has no recorded held-from state to resume to' });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.apply(tx, order, heldFrom, { actorId: principal.userId, reason: 'resume' });
    });
    return this.getOrder(principal, orderId);
  }
}
