/**
 * Owner cockpit contract (Increment 14a) — the thin, additive, OWNER-scoped read shapes for the
 * owner app (PRD §4.3 / §7C). Three reads, no writes, no schema change: the server aggregates and
 * the app renders (server-authoritative — no KPI/approval business logic client-side). Money crosses
 * the wire as fixed-2 dollar strings (the Decimal(12,2) form), currency is CAD this phase.
 *
 * The owner app reuses the proven endpoints for everything else (fleet `/fleet/live` + `WS /live/fleet`,
 * quote `POST /orders/:id/quote:approve|:decline`, `GET /orders/:id`, `GET /routes/:id`, device-tokens).
 * These three fill the confirmed gaps: no today-KPIs read, no aggregated exceptions feed, no
 * pending-approvals list existed in the as-built.
 */

// ───────────────────────────── GET /v1/owner/today (PRD §7C C2) ─────────────────────────────

/**
 * The glanceable day numbers — server-aggregated from real order/payment/stop rows. The owner app
 * renders these verbatim (no client math). `dayStart` is the server day window (the GTA business day,
 * `America/Toronto`) so the client shows an honest "today" without a clock/timezone assumption.
 */
export interface OwnerTodayResult {
  /** Start of the current business day (ISO-8601) the counts are measured from. */
  dayStart: string;
  /** When the snapshot was computed (ISO-8601). */
  generatedAt: string;
  /** Timezone used for the day window. */
  timezone: string;
  /** Orders BOOKED today (createdAt ≥ dayStart). */
  ordersToday: number;
  /** Orders currently in flight (not in a terminal state). */
  activeOrders: number;
  /** Orders that reached DELIVERED / INVOICED / CLOSED today. */
  completedToday: number;
  /** Pending quote approvals right now (status QUOTED) — also the Approvals tab badge. */
  pendingApprovals: number;
  /** Open exception items right now (failed/skipped stops + held orders + open disputes + failed payments). */
  openExceptions: number;
  /** GMV approved today: Σ order total of quotes approved today. Fixed-2 dollar string. */
  revenueToday: string;
  /** Cash collected today: Σ captured amount of payments captured today (SUCCEEDED). Fixed-2 dollar string. */
  collectedToday: string;
  /** ISO-4217 (CAD this phase). */
  currency: string;
  /**
   * On-time % today: of stops COMPLETED today that carried a time window, the fraction completed by
   * the window end. `null` when no completed-today stop had a window (nothing to measure yet).
   */
  onTimePercent: number | null;
}

// ───────────────────────────── GET /v1/owner/approvals (PRD §7C C3) ─────────────────────────────

/**
 * One pending quote approval — a QUOTED order awaiting an approve/decline. The action reuses the
 * proven `POST /orders/:id/quote:approve` / `:decline` (server-authoritative; a 409 means the quote
 * moved out from under us → re-sync). The as-built supports QUOTE approvals only (no threshold /
 * claims / credits approval objects exist), so this is exactly what an owner can act on.
 */
export interface OwnerApproval {
  orderId: string;
  quoteId: string;
  accountName: string;
  siteName: string | null;
  itemCount: number;
  /** The quote total (fixed-2 dollar string). */
  total: string;
  currency: string;
  /** When the quote was sent (ISO-8601). */
  quotedAt: string;
  /** When the quote lapses (ISO-8601), or null if no expiry set. */
  expiresAt: string | null;
}

export interface OwnerApprovalsResult {
  approvals: OwnerApproval[];
}

// ───────────────────────────── GET /v1/owner/exceptions (PRD §7C C4) ─────────────────────────────

/** The source/kind of an owner-attention exception — also the deep-link target discriminator. */
export type OwnerExceptionKind =
  | 'STOP_FAILED'
  | 'STOP_SKIPPED'
  | 'ORDER_HELD'
  | 'PAYMENT_DISPUTE'
  | 'PAYMENT_FAILED';

/**
 * A normalized "needs the owner's attention" item. Each carries the ids the app deep-links into (the
 * same objects the console shows — read-only drill-through, PRD §7C C5). `amount`/`currency` are set
 * for finance exceptions, else null.
 */
export interface OwnerException {
  /** The source row id (stop / order / dispute / payment). */
  id: string;
  kind: OwnerExceptionKind;
  /** Glanceable headline. */
  title: string;
  /** Reason / context (exception reason, hold-from, dispute reason, last payment error), or null. */
  detail: string | null;
  orderId: string | null;
  routeId: string | null;
  stopId: string | null;
  /** Fixed-2 dollar string for finance exceptions, else null. */
  amount: string | null;
  currency: string | null;
  /** When it occurred (ISO-8601). The feed is sorted by this, newest first. */
  occurredAt: string;
}

export interface OwnerExceptionsResult {
  exceptions: OwnerException[];
}
