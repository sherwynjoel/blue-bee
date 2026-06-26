import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ClaimStatus,
  ClaimType,
  GeofenceEventType,
  InvoiceStatus,
  ItemStatus,
  OrderStatus,
  PaymentStatus,
  QuoteStatus,
  RouteStopKind,
  RouteStopStatus,
  type AccountScorecard,
  type CommercialAnalytics,
  type Metric,
  type MetricStatus,
  type OperationalAnalytics,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma, type ScopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import {
  InvalidRangeError,
  agingBucket,
  avgDwellMinutes,
  daysBetween,
  formatMoney,
  hoursBetween,
  median,
  monthsBetween,
  onTimePercent,
  parseRange,
  pct,
  ratio,
  sumCents,
  toCents,
  weeksBetween,
  windowEnd,
} from './analytics-kpi';

/** The GTA business day / display timezone (shared with the owner cockpit). */
const ANALYTICS_TZ = process.env.OWNER_BUSINESS_TZ ?? 'America/Toronto';
const CURRENCY = 'CAD';
/** Stops that reached a terminal state (the denominator for adherence / failed-skip / on-time). */
const TERMINAL_STOP_STATUSES = [RouteStopStatus.COMPLETED, RouteStopStatus.FAILED, RouteStopStatus.SKIPPED];
const PICKUP_KINDS = [RouteStopKind.PICKUP, RouteStopKind.BOTH];
const DELIVERY_KINDS = [RouteStopKind.DELIVERY, RouteStopKind.BOTH];
/** An invoice is "unpaid" (counts toward AR) while not fully paid or voided. */
const UNPAID_INVOICE_STATUSES = [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE];
/** Items considered "completed" by the plant (throughput proxy). */
const COMPLETED_ITEM_STATUSES = [ItemStatus.READY, ItemStatus.DELIVERED];
/** The two geofence transitions that bound on-site dwell. */
const DWELL_EVENT_TYPES = [GeofenceEventType.ARRIVED, GeofenceEventType.DEPARTED];

/** Pull a numeric `total` (fixed-2 dollar string) out of an Order.totals JSON, or null when absent. */
function orderTotalString(totals: unknown): string | null {
  if (totals && typeof totals === 'object' && 'total' in totals) {
    const t = (totals as { total?: unknown }).total;
    if (typeof t === 'string' && t.trim() !== '' && Number.isFinite(Number(t))) return t;
    if (typeof t === 'number' && Number.isFinite(t)) return t.toFixed(2);
  }
  return null;
}

/**
 * Analytics reads (Increment 15, PRD §13 / Epic B6.1 "MVP basic") — thin, READ-ONLY, RBAC-gated,
 * org-scoped aggregations the web console renders. The server does ALL the math over the PROVEN
 * `scopedPrisma` client (org boundary unforgettable), reusing the Inc-14a owner-KPI helpers (money /
 * on-time / window math). Read-only: no schema change, no writes.
 *
 * Two invariants this service guarantees:
 *   • HONESTY FIREWALL — every number traces to a real query; Phase-2-only metrics
 *     (par/contracts/cost-centres/CSAT/labour-hours) are returned as `unavailable_in_phase_1`, never
 *     faked, never silently zero.
 *   • GRACEFUL DEGRADATION — each sub-metric is computed inside {@link metric}; one failure flags THAT
 *     metric `error` and returns a partial payload — it never 500s the whole dashboard.
 *
 * Each metric is O(1) queries (a count/findMany + in-JS aggregation — no N+1), tuned for the typical
 * console window (days→a few months). Multi-year windows on high-volume orgs would want pushed-down
 * SQL aggregation; that's a Phase-3 BI concern (PRD §14.1 keeps this MVP-basic).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── helpers (honesty + degradation) ─────────────────────────

  /** Wrap a metric computation so a single failure degrades to `error` (partial payload, no 500). */
  private async metric<T>(
    note: string,
    fn: () => Promise<{ value: T | null; rowCount: number | null }>,
  ): Promise<Metric<T>> {
    try {
      const { value, rowCount } = await fn();
      return { value, available: true, status: 'ok' as MetricStatus, rowCount, note };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`analytics metric failed [${note}]: ${message}`);
      return { value: null, available: false, status: 'error', rowCount: null, note: `compute failed: ${message}` };
    }
  }

  /** A metric whose ONLY data source is a Phase-2 capability — omitted honestly, never faked. */
  private deferred<T>(note: string): Metric<T> {
    return { value: null, available: false, status: 'unavailable_in_phase_1', rowCount: null, note };
  }

  /** Parse `from`/`to` query params into a window, mapping a bad range to a 400 (problem+json). */
  private window(fromRaw?: string, toRaw?: string, defaultDays = 30): { from: Date; to: Date } {
    try {
      return parseRange(fromRaw, toRaw, new Date(), defaultDays);
    } catch (err) {
      if (err instanceof InvalidRangeError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  // ───────────────────────────── operational dashboard ─────────────────────────────

  async operational(principal: RequestPrincipal, fromRaw?: string, toRaw?: string): Promise<OperationalAnalytics> {
    const db = scopedPrisma(this.prisma, principal);
    const { from, to } = this.window(fromRaw, toRaw);
    const generatedAt = new Date();

    const [
      onTimePickupPercent,
      onTimeDeliveryPercent,
      routeAdherencePercent,
      stopsPerHour,
      avgDwell,
      failedSkipRatePercent,
      itemsLostRatePercent,
      rewashRatePercent,
      plantThroughput,
    ] = await Promise.all([
      this.metric<number>(
        'On-time PICKUP %: COMPLETED pickup RouteStops with a time window completed by window end.',
        () => this.onTimeByKind(db, from, to, PICKUP_KINDS),
      ),
      this.metric<number>(
        'On-time DELIVERY %: COMPLETED delivery RouteStops with a time window completed by window end.',
        () => this.onTimeByKind(db, from, to, DELIVERY_KINDS),
      ),
      this.metric<number>(
        'Route adherence %: COMPLETED ÷ terminal (COMPLETED+FAILED+SKIPPED) RouteStops, by updatedAt in range.',
        () => this.routeAdherence(db, from, to),
      ),
      this.metric<number>(
        'Stops/hour: COMPLETED stops ÷ Σ per-route active hours (last completedAt − first arrivedAt).',
        () => this.stopsPerHour(db, from, to),
      ),
      this.metric<number>(
        'Avg dwell (min): GeofenceEvent ARRIVED→DEPARTED per stop (fallback RouteStop arrivedAt→completedAt).',
        () => this.avgDwell(db, from, to),
      ),
      this.metric<number>(
        'Failed/skip rate %: (FAILED+SKIPPED) ÷ terminal RouteStops, by updatedAt in range.',
        () => this.failedSkipRate(db, from, to),
      ),
      this.metric<number>(
        'Items-lost rate %: distinct items with a LOSS Claim ÷ Items created in range.',
        () => this.itemsLostRate(db, from, to),
      ),
      this.metric<number>(
        'Rewash rate %: Orders currently in REWASH ÷ Orders created in range (status snapshot).',
        () => this.rewashRate(db, from, to),
      ),
      this.metric(
        'Plant throughput: Items reaching READY/DELIVERED (updatedAt in range) + per-day.',
        () => this.plantThroughput(db, from, to),
      ),
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: generatedAt.toISOString(),
      timezone: ANALYTICS_TZ,
      metrics: {
        onTimePickupPercent,
        onTimeDeliveryPercent,
        routeAdherencePercent,
        stopsPerHour,
        avgDwellMinutes: avgDwell,
        failedSkipRatePercent,
        itemsLostRatePercent,
        rewashRatePercent,
        plantThroughput,
        parStockoutIncidents: this.deferred<number>(
          'Deferred to Phase 2 — par levels / standing orders are not modelled in Phase 1 (no stockout source).',
        ),
        ppoh: this.deferred<number>(
          'Deferred to Phase 2 — no labour-hours / timeclock model exists to normalise throughput per operator-hour.',
        ),
      },
    };
  }

  private async onTimeByKind(
    db: ScopedPrisma,
    from: Date,
    to: Date,
    kinds: RouteStopKind[],
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const stops = await db.routeStop.findMany({
      where: { status: RouteStopStatus.COMPLETED, kind: { in: kinds }, completedAt: { gte: from, lt: to } },
      select: { completedAt: true, timeWindow: true },
    });
    const measurable = stops.map((s) => ({ completedAt: s.completedAt, windowEnd: windowEnd(s.timeWindow) }));
    const withWindow = measurable.filter((s) => s.windowEnd !== null);
    return { value: onTimePercent(measurable), rowCount: withWindow.length };
  }

  private async routeAdherence(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const stops = await db.routeStop.findMany({
      where: { status: { in: TERMINAL_STOP_STATUSES }, updatedAt: { gte: from, lt: to } },
      select: { status: true },
    });
    const completed = stops.filter((s) => s.status === RouteStopStatus.COMPLETED).length;
    return { value: pct(completed, stops.length), rowCount: stops.length };
  }

  private async failedSkipRate(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const stops = await db.routeStop.findMany({
      where: { status: { in: TERMINAL_STOP_STATUSES }, updatedAt: { gte: from, lt: to } },
      select: { status: true },
    });
    const failed = stops.filter(
      (s) => s.status === RouteStopStatus.FAILED || s.status === RouteStopStatus.SKIPPED,
    ).length;
    return { value: pct(failed, stops.length), rowCount: stops.length };
  }

  private async stopsPerHour(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const stops = await db.routeStop.findMany({
      where: {
        status: RouteStopStatus.COMPLETED,
        completedAt: { gte: from, lt: to },
        arrivedAt: { not: null },
      },
      select: { routeId: true, arrivedAt: true, completedAt: true },
    });
    // Active on-site hours per route = last completedAt − first arrivedAt; sum across routes.
    const byRoute = new Map<string, { firstArrived: Date; lastCompleted: Date; count: number }>();
    for (const s of stops) {
      if (!s.arrivedAt || !s.completedAt) continue;
      const cur = byRoute.get(s.routeId);
      if (!cur) {
        byRoute.set(s.routeId, { firstArrived: s.arrivedAt, lastCompleted: s.completedAt, count: 1 });
      } else {
        if (s.arrivedAt < cur.firstArrived) cur.firstArrived = s.arrivedAt;
        if (s.completedAt > cur.lastCompleted) cur.lastCompleted = s.completedAt;
        cur.count += 1;
      }
    }
    let totalHours = 0;
    let totalStops = 0;
    for (const r of byRoute.values()) {
      totalHours += hoursBetween(r.firstArrived, r.lastCompleted);
      totalStops += r.count;
    }
    return { value: ratio(totalStops, totalHours), rowCount: totalStops };
  }

  private async avgDwell(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    // Precise on-site interval from geofence ARRIVED→DEPARTED pairs (in range by occurredAt).
    const events = await db.geofenceEvent.findMany({
      where: { occurredAt: { gte: from, lt: to }, type: { in: DWELL_EVENT_TYPES } },
      select: { routeStopId: true, type: true, occurredAt: true },
    });
    const geo = new Map<string, { arrivedAt: Date | null; departedAt: Date | null }>();
    for (const e of events) {
      const cur = geo.get(e.routeStopId) ?? { arrivedAt: null, departedAt: null };
      if (e.type === GeofenceEventType.ARRIVED) cur.arrivedAt = e.occurredAt;
      if (e.type === GeofenceEventType.DEPARTED) cur.departedAt = e.occurredAt;
      geo.set(e.routeStopId, cur);
    }
    const geoPairs = [...geo.values()].filter((p) => p.arrivedAt && p.departedAt);

    // Fallback for stops with no geofence pair: RouteStop arrivedAt→completedAt (completed in range).
    const stops = await db.routeStop.findMany({
      where: {
        status: RouteStopStatus.COMPLETED,
        completedAt: { gte: from, lt: to },
        arrivedAt: { not: null },
        id: { notIn: [...geo.keys()] },
      },
      select: { arrivedAt: true, completedAt: true },
    });
    const fallback = stops.map((s) => ({ arrivedAt: s.arrivedAt, departedAt: s.completedAt }));

    const all = [...geoPairs, ...fallback];
    return { value: avgDwellMinutes(all), rowCount: all.length };
  }

  private async itemsLostRate(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const [totalItems, lossClaims] = await Promise.all([
      db.item.count({ where: { createdAt: { gte: from, lt: to } } }),
      db.claim.findMany({
        where: { type: ClaimType.LOSS, createdAt: { gte: from, lt: to }, itemId: { not: null } },
        select: { itemId: true },
      }),
    ]);
    const lostItems = new Set(lossClaims.map((c) => c.itemId)).size;
    return { value: pct(lostItems, totalItems), rowCount: totalItems };
  }

  private async rewashRate(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const [totalOrders, rewash] = await Promise.all([
      db.order.count({ where: { createdAt: { gte: from, lt: to } } }),
      db.order.count({ where: { createdAt: { gte: from, lt: to }, status: OrderStatus.REWASH } }),
    ]);
    return { value: pct(rewash, totalOrders), rowCount: totalOrders };
  }

  private async plantThroughput(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: { itemsCompleted: number; perDay: number } | null; rowCount: number | null }> {
    const itemsCompleted = await db.item.count({
      where: { status: { in: COMPLETED_ITEM_STATUSES }, updatedAt: { gte: from, lt: to } },
    });
    const days = daysBetween(from, to);
    const perDay = Math.round((itemsCompleted / days) * 100) / 100;
    return { value: { itemsCompleted, perDay }, rowCount: itemsCompleted };
  }

  // ───────────────────────────── commercial dashboard ─────────────────────────────

  async commercial(principal: RequestPrincipal, fromRaw?: string, toRaw?: string): Promise<CommercialAnalytics> {
    const db = scopedPrisma(this.prisma, principal);
    const { from, to } = this.window(fromRaw, toRaw);
    const generatedAt = new Date();

    const [
      trackedGmv,
      jobCount,
      jobsPerWeek,
      repeatRatePercent,
      revenuePerRoute,
      arAging,
      quoteApprovalConversionPercent,
      medianQuoteApprovalHours,
      damageClaimRatePercent,
      medianClaimResolutionDays,
    ] = await Promise.all([
      this.metric<string>('Tracked GMV: Σ Order.totals.total over Orders created in range.', () =>
        this.trackedGmv(db, from, to),
      ),
      this.metric<number>('Jobs: Order rows created in range.', () => this.jobCount(db, from, to)),
      this.metric<number>('Jobs/week: jobCount ÷ weeks in range.', () => this.jobsPerWeek(db, from, to)),
      this.metric<number>(
        'Repeat rate %: accounts with >1 Order ÷ accounts with ≥1 Order, in range.',
        () => this.repeatRate(db, from, to),
      ),
      this.metric<string>(
        'Revenue/route: Σ totals of Orders on routes created in range ÷ routes in range.',
        () => this.revenuePerRoute(db, from, to),
      ),
      this.metric('AR aging: unpaid Invoices issued in range, aged to range end (deterministic asOf).', () =>
        this.arAging(db, from, to),
      ),
      this.metric<number>(
        'Quote→approval conversion %: APPROVED ÷ non-DRAFT Quotes created in range.',
        () => this.quoteConversion(db, from, to),
      ),
      this.metric<number>(
        'Median quote-approval hours: median(approvedAt − createdAt) over APPROVED quotes in range.',
        () => this.medianQuoteApprovalHours(db, from, to),
      ),
      this.metric<number>(
        'Damage-claim rate %: DAMAGE Claims created in range ÷ Orders created in range.',
        () => this.damageClaimRate(db, from, to),
      ),
      this.metric<number>(
        'Median claim-resolution days: median(updatedAt − createdAt) over RESOLVED claims in range.',
        () => this.medianClaimResolutionDays(db, from, to),
      ),
    ]);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: generatedAt.toISOString(),
      currency: CURRENCY,
      metrics: {
        trackedGmv,
        jobCount,
        jobsPerWeek,
        repeatRatePercent,
        revenuePerRoute,
        arAging,
        quoteApprovalConversionPercent,
        medianQuoteApprovalHours,
        damageClaimRatePercent,
        medianClaimResolutionDays,
        activeContracts: this.deferred<number>(
          'Deferred to Phase 2 — contracts / standing orders are not modelled in Phase 1.',
        ),
        csat: this.deferred<number>('Deferred to Phase 2 — no CSAT / satisfaction survey capture exists in Phase 1.'),
      },
    };
  }

  private async trackedGmv(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: string | null; rowCount: number | null }> {
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { totals: true },
    });
    const totals = orders.map((o) => orderTotalString(o.totals)).filter((t): t is string => t !== null);
    return { value: formatMoney(sumCents(totals)), rowCount: totals.length };
  }

  private async jobCount(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const count = await db.order.count({ where: { createdAt: { gte: from, lt: to } } });
    return { value: count, rowCount: count };
  }

  private async jobsPerWeek(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const count = await db.order.count({ where: { createdAt: { gte: from, lt: to } } });
    return { value: ratio(count, weeksBetween(from, to)), rowCount: count };
  }

  private async repeatRate(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from, lt: to } },
      select: { accountId: true },
    });
    const byAccount = new Map<string, number>();
    for (const o of orders) byAccount.set(o.accountId, (byAccount.get(o.accountId) ?? 0) + 1);
    const repeat = [...byAccount.values()].filter((n) => n > 1).length;
    return { value: pct(repeat, byAccount.size), rowCount: byAccount.size };
  }

  private async revenuePerRoute(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: string | null; rowCount: number | null }> {
    const routeCount = await db.route.count({ where: { createdAt: { gte: from, lt: to } } });
    if (routeCount === 0) return { value: null, rowCount: 0 };
    const stops = await db.routeStop.findMany({
      where: { route: { createdAt: { gte: from, lt: to } }, orderId: { not: null } },
      select: { orderId: true, order: { select: { totals: true } } },
    });
    // Dedup orders (an order can appear on a pickup AND a delivery stop) before summing.
    const seen = new Map<string, string>();
    for (const s of stops) {
      if (s.orderId && s.order && !seen.has(s.orderId)) {
        const t = orderTotalString(s.order.totals);
        if (t !== null) seen.set(s.orderId, t);
      }
    }
    const totalCents = sumCents([...seen.values()]);
    return { value: formatMoney(Math.round(totalCents / routeCount)), rowCount: routeCount };
  }

  private async arAging(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: CommercialAnalytics['metrics']['arAging']['value']; rowCount: number | null }> {
    const invoices = await db.invoice.findMany({
      where: { status: { in: UNPAID_INVOICE_STATUSES }, issuedAt: { gte: from, lt: to } },
      select: {
        total: true,
        dueAt: true,
        payments: { where: { status: PaymentStatus.SUCCEEDED }, select: { capturedAmount: true } },
      },
    });
    const labels = ['current', '1-30', '31-60', '61-90', '90+'] as const;
    const buckets = new Map<(typeof labels)[number], { cents: number; count: number }>(
      labels.map((l) => [l, { cents: 0, count: 0 }]),
    );
    let counted = 0;
    for (const inv of invoices) {
      const captured = sumCents(inv.payments.map((p) => p.capturedAmount.toString()));
      const outstanding = toCents(inv.total.toString()) - captured;
      if (outstanding <= 0) continue; // fully settled despite an unpaid status
      const bucket = buckets.get(agingBucket(inv.dueAt, to))!;
      bucket.cents += outstanding;
      bucket.count += 1;
      counted += 1;
    }
    let totalCents = 0;
    const value = {
      asOf: to.toISOString(),
      buckets: labels.map((label) => {
        const b = buckets.get(label)!;
        totalCents += b.cents;
        return { label, amount: formatMoney(b.cents), count: b.count };
      }),
      totalOutstanding: '0.00',
    };
    value.totalOutstanding = formatMoney(totalCents);
    return { value, rowCount: counted };
  }

  private async quoteConversion(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const quotes = await db.quote.findMany({
      where: { createdAt: { gte: from, lt: to }, status: { not: QuoteStatus.DRAFT } },
      select: { status: true },
    });
    const approved = quotes.filter((q) => q.status === QuoteStatus.APPROVED).length;
    return { value: pct(approved, quotes.length), rowCount: quotes.length };
  }

  private async medianQuoteApprovalHours(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const quotes = await db.quote.findMany({
      where: { status: QuoteStatus.APPROVED, approvedAt: { gte: from, lt: to } },
      select: { createdAt: true, approvedAt: true },
    });
    const hours = quotes
      .filter((q) => q.approvedAt != null)
      .map((q) => (q.approvedAt!.getTime() - q.createdAt.getTime()) / 3_600_000)
      .filter((h) => h >= 0);
    const m = median(hours);
    return { value: m === null ? null : Math.round(m * 10) / 10, rowCount: hours.length };
  }

  private async damageClaimRate(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const [orders, damage] = await Promise.all([
      db.order.count({ where: { createdAt: { gte: from, lt: to } } }),
      db.claim.count({ where: { type: ClaimType.DAMAGE, createdAt: { gte: from, lt: to } } }),
    ]);
    return { value: pct(damage, orders), rowCount: orders };
  }

  private async medianClaimResolutionDays(
    db: ScopedPrisma,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const claims = await db.claim.findMany({
      where: { status: ClaimStatus.RESOLVED, updatedAt: { gte: from, lt: to } },
      select: { createdAt: true, updatedAt: true },
    });
    const days = claims
      .map((c) => (c.updatedAt.getTime() - c.createdAt.getTime()) / 86_400_000)
      .filter((d) => d >= 0);
    const m = median(days);
    return { value: m === null ? null : Math.round(m * 10) / 10, rowCount: days.length };
  }

  // ───────────────────────────── per-account scorecard ─────────────────────────────

  async accountScorecard(
    principal: RequestPrincipal,
    accountId: string,
    fromRaw?: string,
    toRaw?: string,
  ): Promise<AccountScorecard> {
    const db = scopedPrisma(this.prisma, principal);
    const { from, to } = this.window(fromRaw, toRaw);
    const generatedAt = new Date();

    // Org-scope guard: scopedPrisma AND-merges the org boundary, so a cross-org (or out-of-scope)
    // account id resolves to null → 404 (never a cross-tenant read). findFirst (not findUnique) so
    // the non-unique orgId scope merges cleanly.
    const account = await db.account.findFirst({ where: { id: accountId }, select: { id: true, name: true } });
    if (!account) throw new NotFoundException(`account ${accountId} not found in scope`);

    const [lossRatePercent, onTimeP, monthlySpend] = await Promise.all([
      this.metric<number>(
        'Loss rate %: distinct items with a LOSS Claim ÷ Items, for this account in range.',
        () => this.accountLossRate(db, accountId, from, to),
      ),
      this.metric<number>(
        'On-time %: COMPLETED stops with a window completed by window end, for this account in range.',
        () => this.accountOnTime(db, accountId, from, to),
      ),
      this.metric('Monthly spend: Σ captured payments for this account in range ÷ months.', () =>
        this.accountMonthlySpend(db, accountId, from, to),
      ),
    ]);

    return {
      accountId: account.id,
      accountName: account.name,
      range: { from: from.toISOString(), to: to.toISOString() },
      generatedAt: generatedAt.toISOString(),
      currency: CURRENCY,
      metrics: {
        lossRatePercent,
        onTimePercent: onTimeP,
        monthlySpend,
        costCenterSplit: this.deferred<Record<string, string>>(
          'Deferred to Phase 2 — cost centres (wing/floor splits) are not modelled in Phase 1.',
        ),
      },
    };
  }

  private async accountLossRate(
    db: ScopedPrisma,
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const [totalItems, lossClaims] = await Promise.all([
      db.item.count({ where: { order: { accountId }, createdAt: { gte: from, lt: to } } }),
      db.claim.findMany({
        where: { type: ClaimType.LOSS, order: { accountId }, createdAt: { gte: from, lt: to }, itemId: { not: null } },
        select: { itemId: true },
      }),
    ]);
    const lostItems = new Set(lossClaims.map((c) => c.itemId)).size;
    return { value: pct(lostItems, totalItems), rowCount: totalItems };
  }

  private async accountOnTime(
    db: ScopedPrisma,
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<{ value: number | null; rowCount: number | null }> {
    const stops = await db.routeStop.findMany({
      where: { accountId, status: RouteStopStatus.COMPLETED, completedAt: { gte: from, lt: to } },
      select: { completedAt: true, timeWindow: true },
    });
    const measurable = stops.map((s) => ({ completedAt: s.completedAt, windowEnd: windowEnd(s.timeWindow) }));
    const withWindow = measurable.filter((s) => s.windowEnd !== null);
    return { value: onTimePercent(measurable), rowCount: withWindow.length };
  }

  private async accountMonthlySpend(
    db: ScopedPrisma,
    accountId: string,
    from: Date,
    to: Date,
  ): Promise<{ value: AccountScorecard['metrics']['monthlySpend']['value']; rowCount: number | null }> {
    const payments = await db.payment.findMany({
      where: { order: { accountId }, status: PaymentStatus.SUCCEEDED, capturedAt: { gte: from, lt: to } },
      select: { capturedAmount: true },
    });
    const totalCents = sumCents(payments.map((p) => p.capturedAmount.toString()));
    const months = monthsBetween(from, to);
    return {
      value: {
        total: formatMoney(totalCents),
        perMonth: formatMoney(Math.round(totalCents / months)),
        months: Math.round(months * 10) / 10,
      },
      rowCount: payments.length,
    };
  }
}
