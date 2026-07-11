/**
 * Analytics contract (Increment 15) — the thin, READ-ONLY, org-scoped aggregation shapes the web
 * console renders for the operational + commercial dashboards and the per-account scorecard
 * (PRD §13, Epic B6.1 "MVP basic"). The server does ALL the aggregation over real Phase-1 rows; the
 * console renders the result verbatim (server-authoritative — no KPI math client-side).
 *
 * HONESTY FIREWALL (CLAUDE.md, non-negotiable). Every number is wrapped in a {@link Metric} that
 * declares its provenance:
 *   • status 'ok'                      → computed from real rows (`rowCount` = how many).
 *   • status 'unavailable_in_phase_1'  → the metric's ONLY data source is a Phase-2 capability
 *                                         (par/contracts/cost-centres/CSAT/labour-hours). It is NEVER
 *                                         faked, hardcoded, or silently zero — `value` is null and the
 *                                         `note` says why it's deferred.
 *   • status 'error'                   → computing THIS sub-metric threw; the rest of the payload is
 *                                         still returned (graceful degradation — one bad metric must
 *                                         not 500 the whole dashboard).
 * A null `value` with status 'ok' means "computed, but no qualifying rows in range" (an honest empty),
 * distinct from a deferred metric. Money crosses the wire as fixed-2 dollar strings (Decimal(12,2)).
 */

export type MetricStatus = 'ok' | 'unavailable_in_phase_1' | 'error';

/** A single analytics number, wrapped so its provenance and availability are always explicit. */
export interface Metric<T> {
  /** The computed value, or null when unavailable/errored or when no rows qualified. */
  value: T | null;
  /** Convenience flag — true iff `status === 'ok'`. */
  available: boolean;
  status: MetricStatus;
  /** For computed metrics: the count of real rows the value was aggregated from (the audit trail). */
  rowCount: number | null;
  /** Source query (computed) · deferral reason (unavailable) · error class (error). */
  note: string;
}

/** The [from, to) window a payload was computed over (ISO-8601; `to` is exclusive). */
export interface AnalyticsRange {
  from: string;
  to: string;
}

// ───────────────────────────── GET /v1/analytics/operational ─────────────────────────────

export interface PlantThroughput {
  /** Items that reached READY/DELIVERED in range (real Item rows). */
  itemsCompleted: number;
  /** itemsCompleted ÷ days in range. */
  perDay: number;
}

export interface OperationalAnalytics {
  range: AnalyticsRange;
  generatedAt: string;
  timezone: string;
  metrics: {
    /** On-time PICKUP %: of COMPLETED pickup stops carrying a window, the fraction by the window end. */
    onTimePickupPercent: Metric<number>;
    /** On-time DELIVERY %: same, over delivery stops. */
    onTimeDeliveryPercent: Metric<number>;
    /** Route adherence %: of stops that reached a terminal state, the fraction COMPLETED (not failed/skipped). */
    routeAdherencePercent: Metric<number>;
    /** Stops/hour: completed stops ÷ on-site active hours (Σ per route of last completed − first arrived). */
    stopsPerHour: Metric<number>;
    /** Avg dwell (minutes) on site, from GeofenceEvent ARRIVED→DEPARTED pairs (fallback arrived→completed). */
    avgDwellMinutes: Metric<number>;
    /** Failed/skip rate %: (FAILED + SKIPPED) ÷ terminal stops. */
    failedSkipRatePercent: Metric<number>;
    /** Items-lost rate %: distinct items with a LOSS claim ÷ items in range. */
    itemsLostRatePercent: Metric<number>;
    /** Rewash rate %: orders currently in REWASH ÷ orders in range (snapshot; full reject/reclaim is P2). */
    rewashRatePercent: Metric<number>;
    /** Plant throughput: items completed in range + per-day (proxy; per-operator-hour PPOH is deferred). */
    plantThroughput: Metric<PlantThroughput>;
    /** DEFERRED (Phase 2 — par levels / contracts). Never faked. */
    parStockoutIncidents: Metric<number>;
    /** DEFERRED (Phase 2 — no labour-hours / timeclock model to normalise per operator-hour). Never faked. */
    ppoh: Metric<number>;
  };
}

// ───────────────────────────── GET /v1/analytics/commercial ─────────────────────────────

export type ArBucketLabel = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface ArAgingBucket {
  label: ArBucketLabel;
  /** Outstanding balance in this bucket (fixed-2 dollar string). */
  amount: string;
  /** Unpaid invoices falling in this bucket. */
  count: number;
}

export interface ArAging {
  /** The "as of" date aging is measured against (the range end — deterministic). */
  asOf: string;
  buckets: ArAgingBucket[];
  /** Σ outstanding across all buckets (fixed-2 dollar string). */
  totalOutstanding: string;
}

export interface CommercialAnalytics {
  range: AnalyticsRange;
  generatedAt: string;
  currency: string;
  metrics: {
    /** Tracked GMV: Σ Order.totals.total over orders created in range (fixed-2 dollar string). */
    trackedGmv: Metric<string>;
    /** Jobs in range (Order rows). */
    jobCount: Metric<number>;
    /** Jobs/week: jobCount ÷ weeks in range. */
    jobsPerWeek: Metric<number>;
    /** Repeat rate %: accounts with >1 order in range ÷ accounts with ≥1 order. */
    repeatRatePercent: Metric<number>;
    /** Revenue/route: Σ totals of routed orders ÷ routes in range (fixed-2 dollar string). */
    revenuePerRoute: Metric<string>;
    /** AR aging snapshot of unpaid invoices issued in range, aged to the range end. */
    arAging: Metric<ArAging>;
    /** Quote→approval conversion %: approved ÷ (sent + approved + declined) quotes in range. */
    quoteApprovalConversionPercent: Metric<number>;
    /** Median hours from quote create → approve (approved quotes in range). */
    medianQuoteApprovalHours: Metric<number>;
    /** Damage-claim rate %: DAMAGE claims ÷ orders in range. */
    damageClaimRatePercent: Metric<number>;
    /**
     * Median days to resolve a claim (RESOLVED claims in range). Resolution time is approximated as
     * updatedAt − createdAt — the Claim model has no dedicated `resolvedAt`, and `updatedAt` is the
     * instant the status transitioned to RESOLVED. An exact SLA field is a Phase-2 add.
     */
    medianClaimResolutionDays: Metric<number>;
    /** DEFERRED (Phase 2 — no contract model in Phase 1). Never faked. */
    activeContracts: Metric<number>;
    /** DEFERRED (Phase 2 — no CSAT/survey capture in Phase 1). Never faked. */
    csat: Metric<number>;
  };
}

// ───────────────── GET /v1/analytics/accounts/:accountId/scorecard ─────────────────

export interface AccountMonthlySpend {
  /** Σ captured payments for the account in range (fixed-2 dollar string). */
  total: string;
  /** total ÷ months in range (fixed-2 dollar string). */
  perMonth: string;
  /** Months spanned by the range (≥ a small floor to avoid divide-by-zero). */
  months: number;
}

export interface AccountScorecard {
  accountId: string;
  accountName: string;
  range: AnalyticsRange;
  generatedAt: string;
  currency: string;
  metrics: {
    /** Loss rate %: distinct items with a LOSS claim ÷ items, for THIS account in range. */
    lossRatePercent: Metric<number>;
    /** On-time %: completed stops with a window completed by window end, for THIS account in range. */
    onTimePercent: Metric<number>;
    /** Monthly spend: Σ captured payments for the account in range + per-month. */
    monthlySpend: Metric<AccountMonthlySpend>;
    /** [Inc-32] Average post-delivery rating (1–5) over this account's ratings in range. Null when none. */
    avgRatingScore: Metric<number>;
    /** DEFERRED (Phase 2 — cost centres / wing-floor splits). Never faked. */
    costCenterSplit: Metric<Record<string, string>>;
  };
}
