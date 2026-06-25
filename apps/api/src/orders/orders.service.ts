import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
  type BookOrderDto,
  type HoldOrderDto,
  type ListOrdersQuery,
  type ResumeOrderDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { isOrgWide } from '../auth/rbac/policy';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from './audit.service';
import { MediaSigner } from '../media/storage/media-signer';
import { OrderAccessService } from './order-access.service';
import { PricingService } from './pricing.service';
import { OrderStateMachine } from './state-machine.service';
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
  lines: { orderBy: { createdAt: 'asc' as const } },
  items: {
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
} satisfies Prisma.OrderInclude;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly pricing: PricingService,
    private readonly stateMachine: OrderStateMachine,
    private readonly audit: AuditService,
    private readonly signer: MediaSigner,
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

    // Site (optional) must belong to that account + org.
    if (dto.siteId) {
      const site = await this.prisma.site.findFirst({ where: { id: dto.siteId, orgId, accountId: dto.accountId } });
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

    // Pre-resolve rates and build a rough estimate range (PRD §7A A2.1 — pre-intake).
    const rateByService = new Map<string, number>();
    for (const id of serviceIds) {
      const r = await this.pricing.resolveRate(orgId, dto.accountId, id);
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

        for (const item of dto.items) {
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
            after: { status: OrderStatus.REQUESTED, accountId: dto.accountId, itemCount: dto.items.length, estimateRange },
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
    const where: Prisma.OrderWhereInput = query.status ? { status: query.status as unknown as Prisma.OrderWhereInput['status'] } : {};
    const rows = await db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { quotes: { orderBy: { createdAt: 'desc' }, take: 1 } },
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
