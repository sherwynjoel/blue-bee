/**
 * Pickup availability + the org's operating schedule (Increment 28) — PRD §7A A2.1.
 *
 * Before this increment the customer app hard-coded "tomorrow 9am–12pm" behind a Switch, and no
 * availability, capacity, or operating-hours concept existed anywhere in the platform. This file is the
 * contract for the three pieces that replace it: the founder's saved schedule (`OrgSchedule`), the
 * OWNER console that writes it, and the day's bookable slots the customer picker reads.
 *
 * Three honesty rules are encoded in the TYPES, not left to the implementation:
 *
 *  1. **Scarcity is never fabricated.** `maxPerSlot: null` means the founder has set no cap, so every
 *     defined slot is `available: true` and `remaining: null`. `PickupSlotsResult.capacityChecked`
 *     distinguishes "we counted against a real cap" from "there was no cap to count against" — the same
 *     three-state shape as `SiteServiceability.checked` (Inc-26). A UI must never render "2 left" from
 *     a `null`.
 *
 *  2. **A default is labelled as a default.** `scheduleSource: 'default'` says the founder has not yet
 *     saved real hours and `DEFAULT_PICKUP_SCHEDULE` is being served. It flips to `'org'` the moment a
 *     real schedule is saved through the console. No screen may present a default as the business's
 *     actual hours without saying so.
 *
 *  3. **An unavailable slot says why.** `PickupSlot.reason` is `'past' | 'lead_time' | 'full'`, so the
 *     app disables a slot with the server's reason rather than inventing copy for it.
 *
 * TIME REPRESENTATION. `ScheduleWindow.start/end` are wall-clock `HH:MM` in the org's business timezone
 * (`Organization.settings.tz`, default `America/Toronto`) — that is what a founder types and what a
 * customer reads. `PickupSlot.start/end` are absolute ISO-8601 instants, resolved server-side against
 * the real DST offset for that date. The client never converts between the two.
 */
import { z } from 'zod';

// ───────────────────────────── primitives ─────────────────────────────

/** A local time-of-day "HH:MM" (24h) in the org's business timezone. */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24h HH:MM time-of-day');

/** A weekday: 0=Sunday … 6=Saturday (matches JS `Date.getUTCDay`, and the recurring-order convention). */
const weekday = z.number().int().min(0).max(6);

/**
 * One named operating window the founder offers, e.g. `{ label: 'Morning', start: '09:00', end: '12:00' }`.
 * The label is customer-facing: it is what the picker shows above the time range.
 */
export const scheduleWindowSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    start: hhmm,
    end: hhmm,
  })
  .refine((w) => w.start < w.end, { message: 'window end must be after start' });
export type ScheduleWindow = z.infer<typeof scheduleWindowSchema>;

/**
 * Reject windows that overlap. Lexicographic `HH:MM` comparison is a correct time ordering because the
 * format is zero-padded and fixed-width. Adjacency is legal and intended (`09:00–12:00` then
 * `12:00–15:00` touch but do not overlap), so the test is `next.start < prev.end`, strictly.
 *
 * Labels must be unique: they are the slot's identity in the picker and in the founder's editor.
 */
function assertDisjointWindows(windows: ScheduleWindow[], ctx: z.RefinementCtx): void {
  const labels = new Set<string>();
  for (const w of windows) {
    const key = w.label.toLowerCase();
    if (labels.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate window label "${w.label}"` });
      return;
    }
    labels.add(key);
  }
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as ScheduleWindow;
    const cur = sorted[i] as ScheduleWindow;
    if (cur.start < prev.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `windows overlap: ${prev.label} (${prev.start}–${prev.end}) and ${cur.label} (${cur.start}–${cur.end})`,
      });
      return;
    }
  }
}

// ───────────────────────────── the org schedule ─────────────────────────────

/**
 * The founder-tunable pickup schedule, persisted at `Organization.settings.schedule`.
 *
 * It lives under `settings`, not `billing_config`: `settings` already carries `{ region, currency, tz }`
 * and operating hours are not a billing concern. (This gives `settings` its first reader — until now it
 * was written at bootstrap and read nowhere.)
 */
export const orgScheduleSchema = z.object({
  /** The named windows offered each open day. At least one, or nothing is bookable. */
  windows: z.array(scheduleWindowSchema).min(1).max(12).superRefine(assertDisjointWindows),
  /**
   * How far ahead of a slot's START a customer must book it. Fractional hours are allowed (0.5 = 30 min);
   * 0 means a slot is bookable until the instant it begins.
   */
  leadTimeHours: z.number().min(0).max(168),
  /** How many calendar days of availability to offer, counting today as day 1. */
  horizonDays: z.number().int().min(1).max(30),
  /**
   * Max orders whose pickup window overlaps a given slot. `null` = **no cap configured**, which means
   * every defined slot is available and the server does not count anything. It never means "unlimited
   * capacity, and we checked".
   */
  maxPerSlot: z.number().int().min(1).max(1000).nullable(),
  /** Weekdays the business does not collect on. Cannot be all seven — that would close the business. */
  closedDays: z
    .array(weekday)
    .max(7)
    .refine((d) => new Set(d).size < 7, { message: 'closedDays cannot close every day of the week' }),
});
export type OrgSchedule = z.infer<typeof orgScheduleSchema>;

/**
 * The DOCUMENTED DEFAULT, served (and labelled `scheduleSource: 'default'`) until the founder saves real
 * hours in the console. Same pattern as the `0.13` HST default in `PricingService.resolveTaxRate`: a real,
 * working value that is honestly announced as a default rather than as the business's actual hours.
 *
 * `maxPerSlot: null` is deliberate — Blue Bee has no measured per-slot truck capacity yet, so shipping a
 * number here would be inventing scarcity.
 */
export const DEFAULT_PICKUP_SCHEDULE: OrgSchedule = {
  windows: [
    { label: 'Morning', start: '09:00', end: '12:00' },
    { label: 'Afternoon', start: '12:00', end: '15:00' },
    { label: 'Evening', start: '15:00', end: '18:00' },
  ],
  leadTimeHours: 2,
  horizonDays: 7,
  maxPerSlot: null,
  closedDays: [],
};

/** Whether a served schedule is the founder's saved one or the built-in default. */
export type ScheduleSource = 'org' | 'default';

// ───────────────────────────── GET/PATCH /v1/admin/settings/schedule (Part C) ─────────────────────────

/** PATCH body — a FULL replacement of the schedule (not a merge; a partial window list is ambiguous). */
export const updateOrgScheduleSchema = orgScheduleSchema;
export type UpdateOrgScheduleDto = z.infer<typeof updateOrgScheduleSchema>;

/** GET/PATCH result — the effective schedule plus where it came from. */
export interface OrgScheduleView {
  schedule: OrgSchedule;
  /** The org's business timezone (`Organization.settings.tz`) — the frame `HH:MM` is interpreted in. */
  timezone: string;
  /** `'default'` until the founder saves real hours; the console must say so on screen. */
  source: ScheduleSource;
}

// ───────────────────────────── GET /v1/availability/pickup-slots (Part A) ─────────────────────────────

/** `date` is a business-local calendar date; omit it to get the first bookable day. */
export const pickupSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional(),
  /** The pickup address. Row-scoped: another account's site is a 404, never a 403 (no existence leak). */
  siteId: z.string().uuid().optional(),
});
export type PickupSlotsQuery = z.infer<typeof pickupSlotsQuerySchema>;

/** Why a slot cannot be booked. `null` when it can. */
export type PickupSlotUnavailableReason =
  /** Its start has passed — the window is under way, or over. You can no longer book ahead of it. */
  | 'past'
  /** Its start is still ahead, but sooner than `leadTimeHours` away. A policy the app can explain. */
  | 'lead_time'
  /** A real cap is configured and this slot is at it. Only ever set when `capacityChecked` is true. */
  | 'full';

/** One bookable (or explicitly unbookable) pickup window on the requested day. */
export interface PickupSlot {
  /** The founder's customer-facing name for this window ("Morning"). */
  label: string;
  /** Absolute ISO-8601 instants, DST-resolved server-side. This is exactly what `pickupWindow` carries. */
  start: string;
  end: string;
  /**
   * The SAME window as wall-clock `HH:MM` in `PickupSlotsResult.timezone` — i.e. the hours the founder
   * typed. Display these; never re-derive them from `start`/`end` on the client.
   *
   * Two reasons. A customer travelling (or a B2B admin in another province) would otherwise be shown their
   * own device's rendering of the instant — "6:00 AM" for a 9am Toronto pickup — which is arithmetically
   * true and completely useless. And React Native's Hermes engine ships a partial `Intl` whose
   * `timeZone` option is unreliable on Android, so a client-side conversion is not even dependable.
   */
  startLocal: string;
  endLocal: string;
  available: boolean;
  /** Orders this slot can still take. `null` ⇔ no cap configured — NEVER render a count from it. */
  remaining: number | null;
  reason: PickupSlotUnavailableReason | null;
}

/** GET /v1/availability/pickup-slots. */
export interface PickupSlotsResult {
  /** The business-local calendar date these slots belong to (`YYYY-MM-DD`). */
  date: string;
  /** The org's business timezone — the frame `date` and the windows' wall clock are expressed in. */
  timezone: string;
  /**
   * Every date inside the horizon that has at least one slot a customer could still book (closed days
   * and a today whose windows have all passed the lead-time cut are absent). The picker renders its day
   * chips from this — the SERVER owns the calendar, so a device in another timezone cannot offer a day
   * the business is shut.
   */
  bookableDates: string[];
  /** This date is a configured closed day ⇒ `slots` is empty. */
  closed: boolean;
  /**
   * `true` ⇔ a real `maxPerSlot` is configured and every slot's `available`/`remaining` reflects a real
   * count of overlapping orders. `false` ⇒ no cap exists; `remaining` is `null` throughout and no slot is
   * marked full. (Honesty firewall — an inert gate is not evidence of capacity.)
   */
  capacityChecked: boolean;
  /** `'default'` ⇒ these are the built-in hours, not hours the founder has set. */
  scheduleSource: ScheduleSource;
  /** Every window defined for the day, bookable or not, in start order. Unbookable ones carry a `reason`. */
  slots: PickupSlot[];
}

// ───────────────────────── error codes (problem+json `error`) ─────────────────────────

export const AVAILABILITY_ERRORS = {
  /** 404 — no such site in the caller's row scope (also the cross-account answer: never leak existence). */
  SITE_NOT_FOUND: 'availability.site_not_found',
  /** 400 — `date` is not a real calendar date, is in the past, or is beyond the configured horizon. */
  DATE_OUT_OF_RANGE: 'availability.date_out_of_range',
} as const;
export type AvailabilityErrorCode = (typeof AVAILABILITY_ERRORS)[keyof typeof AVAILABILITY_ERRORS];
