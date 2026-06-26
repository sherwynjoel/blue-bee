/**
 * Recurring-generation config (Track A). Env-driven, mirroring the Inc-8 notifications config shape.
 * The generation job reuses the proven Inc-8 background pattern (OnModuleInit + setInterval drain +
 * idempotent claim) — NOT BullMQ (the repo has no queue library; see the handoff note).
 */
export const RECURRING_CONFIG = Symbol('RECURRING_CONFIG');

export interface RecurringConfig {
  /** Background scan interval (ms) for due-standing-order generation. 0 ⇒ disabled (the test/CI default;
   *  generation is then driven explicitly via the service method / `POST /v1/standing-orders/run`). */
  scanIntervalMs: number;
  /** How far back a generation pass looks for un-materialized occurrences (bounds first-run back-fill;
   *  the occurrence ledger still dedups re-runs). Default 14d covers a missed weekly/biweekly run. */
  lookbackDays: number;
}

function intNonNeg(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function loadRecurringConfig(): RecurringConfig {
  return {
    scanIntervalMs: intNonNeg('RECURRING_SCAN_MS', 0),
    lookbackDays: intNonNeg('RECURRING_LOOKBACK_DAYS', 14),
  };
}
