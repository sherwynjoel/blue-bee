import { Injectable } from '@nestjs/common';
import {
  DisputeStatus,
  OrderStatus,
  PaymentStatus,
  QuoteStatus,
  RouteStopStatus,
  TERMINAL_ORDER_STATUSES,
  type OwnerApproval,
  type OwnerApprovalsResult,
  type OwnerException,
  type OwnerExceptionsResult,
  type OwnerTodayResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { businessDayStart, formatMoney, onTimePercent, sumCents, windowEnd } from './owner-kpi';

/** The GTA business day (overridable for non-Toronto orgs / tests). */
const BUSINESS_TZ = process.env.OWNER_BUSINESS_TZ ?? 'America/Toronto';
/** Terminal/recent windows for the exception feed (terminal stop/payment rows beyond this are history). */
const EXCEPTION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap the exception feed (the `openExceptions` COUNT is still the truth; the list shows the newest). */
const EXCEPTION_FEED_LIMIT = 100;
/** Cap the pending-approvals list. */
const APPROVALS_LIMIT = 100;

const ACTIVE_EXCLUDED = [...TERMINAL_ORDER_STATUSES];
const COMPLETED_TODAY_STATUSES = [OrderStatus.DELIVERED, OrderStatus.INVOICED, OrderStatus.CLOSED];
const EXCEPTION_STOP_STATUSES = [RouteStopStatus.FAILED, RouteStopStatus.SKIPPED];
const OPEN_DISPUTE_STATUSES = [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW];

/**
 * Owner cockpit reads (Increment 14a) — the thin, additive, OWNER-scoped aggregations the owner app
 * renders (PRD §4.3/§7C). Read-only, no schema change: the server does ALL the aggregation (KPI math,
 * exception normalization, the pending-approvals list) over the PROVEN row-scoping Prisma client, so
 * the app stays a pure renderer (server-authoritative, no business logic client-side). Org-scoping is
 * unforgettable — every query goes through `scopedPrisma`, so an owner only ever sees their own org.
 */
@Injectable()
export class OwnerService {
  constructor(private readonly prisma: PrismaService) {}

  /** PRD §7C C2 — the glanceable day numbers, aggregated from real order/payment/stop rows. */
  async today(principal: RequestPrincipal): Promise<OwnerTodayResult> {
    const db = scopedPrisma(this.prisma, principal);
    const now = new Date();
    const dayStart = businessDayStart(now, BUSINESS_TZ);
    const since = new Date(now.getTime() - EXCEPTION_LOOKBACK_MS);

    const [ordersToday, activeOrders, completedToday, pendingApprovals] = await Promise.all([
      db.order.count({ where: { createdAt: { gte: dayStart } } }),
      db.order.count({ where: { status: { notIn: ACTIVE_EXCLUDED } } }),
      db.order.count({ where: { status: { in: COMPLETED_TODAY_STATUSES }, updatedAt: { gte: dayStart } } }),
      db.order.count({ where: { status: OrderStatus.QUOTED } }),
    ]);

    // Open exceptions COUNT (the true badge number — same predicates as the feed; the feed list is capped).
    const [failedSkippedStops, heldOrders, openDisputes, failedPayments] = await Promise.all([
      db.routeStop.count({ where: { status: { in: EXCEPTION_STOP_STATUSES }, updatedAt: { gte: since } } }),
      db.order.count({ where: { status: OrderStatus.ON_HOLD } }),
      db.dispute.count({ where: { status: { in: OPEN_DISPUTE_STATUSES } } }),
      db.payment.count({ where: { status: PaymentStatus.FAILED, updatedAt: { gte: since } } }),
    ]);
    const openExceptions = failedSkippedStops + heldOrders + openDisputes + failedPayments;

    // GMV approved today: Σ order total of quotes that became APPROVED today.
    const approvedToday = await db.quote.findMany({
      where: { status: QuoteStatus.APPROVED, approvedAt: { gte: dayStart } },
      select: { total: true },
    });
    const revenueToday = formatMoney(sumCents(approvedToday.map((q) => q.total.toString())));

    // Cash collected today: Σ captured amount of payments captured today.
    const capturedToday = await db.payment.findMany({
      where: { status: PaymentStatus.SUCCEEDED, capturedAt: { gte: dayStart } },
      select: { capturedAmount: true },
    });
    const collectedToday = formatMoney(sumCents(capturedToday.map((p) => p.capturedAmount.toString())));

    // On-time % over stops completed today that carried a window.
    const completedStops = await db.routeStop.findMany({
      where: { status: RouteStopStatus.COMPLETED, completedAt: { gte: dayStart } },
      select: { completedAt: true, timeWindow: true },
    });
    const onTime = onTimePercent(
      completedStops.map((s) => ({ completedAt: s.completedAt, windowEnd: windowEnd(s.timeWindow) })),
    );

    return {
      dayStart: dayStart.toISOString(),
      generatedAt: now.toISOString(),
      timezone: BUSINESS_TZ,
      ordersToday,
      activeOrders,
      completedToday,
      pendingApprovals,
      openExceptions,
      revenueToday,
      collectedToday,
      currency: 'CAD',
      onTimePercent: onTime,
    };
  }

  /** PRD §7C C3 — pending quote approvals (QUOTED orders awaiting approve/decline). */
  async approvals(principal: RequestPrincipal): Promise<OwnerApprovalsResult> {
    const db = scopedPrisma(this.prisma, principal);
    const orders = await db.order.findMany({
      where: { status: OrderStatus.QUOTED },
      orderBy: { updatedAt: 'desc' },
      take: APPROVALS_LIMIT,
      select: {
        id: true,
        totals: true,
        account: { select: { name: true } },
        site: { select: { name: true } },
        _count: { select: { items: true } },
        quotes: {
          where: { status: QuoteStatus.SENT },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, total: true, createdAt: true, expiresAt: true },
        },
      },
    });

    const approvals: OwnerApproval[] = orders
      .map((o): OwnerApproval | null => {
        const quote = o.quotes[0];
        if (!quote) return null; // QUOTED with no SENT quote shouldn't happen; skip defensively
        const currency = (o.totals as { currency?: string } | null)?.currency ?? 'CAD';
        return {
          orderId: o.id,
          quoteId: quote.id,
          accountName: o.account.name,
          siteName: o.site?.name ?? null,
          itemCount: o._count.items,
          total: quote.total.toFixed(2),
          currency,
          quotedAt: quote.createdAt.toISOString(),
          expiresAt: quote.expiresAt ? quote.expiresAt.toISOString() : null,
        };
      })
      .filter((a): a is OwnerApproval => a !== null);

    return { approvals };
  }

  /** PRD §7C C4 — the exceptions feed (failed/skipped stops, held orders, open disputes, failed payments). */
  async exceptions(principal: RequestPrincipal): Promise<OwnerExceptionsResult> {
    const db = scopedPrisma(this.prisma, principal);
    const since = new Date(Date.now() - EXCEPTION_LOOKBACK_MS);

    const [stops, held, disputes, payments] = await Promise.all([
      db.routeStop.findMany({
        where: { status: { in: EXCEPTION_STOP_STATUSES }, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: {
          id: true,
          status: true,
          exceptionReason: true,
          updatedAt: true,
          routeId: true,
          orderId: true,
          site: { select: { name: true } },
        },
      }),
      db.order.findMany({
        where: { status: OrderStatus.ON_HOLD },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, heldFrom: true, updatedAt: true, account: { select: { name: true } } },
      }),
      db.dispute.findMany({
        where: { status: { in: OPEN_DISPUTE_STATUSES } },
        orderBy: { openedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, status: true, amount: true, currency: true, reason: true, openedAt: true, orderId: true },
      }),
      db.payment.findMany({
        where: { status: PaymentStatus.FAILED, updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: EXCEPTION_FEED_LIMIT,
        select: { id: true, amount: true, currency: true, lastError: true, orderId: true, updatedAt: true },
      }),
    ]);

    const items: OwnerException[] = [
      ...stops.map((s): OwnerException => ({
        id: s.id,
        kind: s.status === RouteStopStatus.FAILED ? 'STOP_FAILED' : 'STOP_SKIPPED',
        title: `Stop ${s.status === RouteStopStatus.FAILED ? 'failed' : 'skipped'}${s.site?.name ? ` — ${s.site.name}` : ''}`,
        detail: s.exceptionReason ?? null,
        orderId: s.orderId,
        routeId: s.routeId,
        stopId: s.id,
        amount: null,
        currency: null,
        occurredAt: s.updatedAt.toISOString(),
      })),
      ...held.map((o): OwnerException => ({
        id: o.id,
        kind: 'ORDER_HELD',
        title: `Order on hold${o.account?.name ? ` — ${o.account.name}` : ''}`,
        detail: o.heldFrom ? `Paused from ${o.heldFrom}` : null,
        orderId: o.id,
        routeId: null,
        stopId: null,
        amount: null,
        currency: null,
        occurredAt: o.updatedAt.toISOString(),
      })),
      ...disputes.map((d): OwnerException => ({
        id: d.id,
        kind: 'PAYMENT_DISPUTE',
        title: `Payment dispute (${d.status})`,
        detail: d.reason ?? null,
        orderId: d.orderId,
        routeId: null,
        stopId: null,
        amount: d.amount.toFixed(2),
        currency: d.currency,
        occurredAt: d.openedAt.toISOString(),
      })),
      ...payments.map((p): OwnerException => ({
        id: p.id,
        kind: 'PAYMENT_FAILED',
        title: 'Payment failed',
        detail: p.lastError ?? null,
        orderId: p.orderId,
        routeId: null,
        stopId: null,
        amount: p.amount.toFixed(2),
        currency: p.currency,
        occurredAt: p.updatedAt.toISOString(),
      })),
    ];

    items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));
    return { exceptions: items.slice(0, EXCEPTION_FEED_LIMIT) };
  }
}
