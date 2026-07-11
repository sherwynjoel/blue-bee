/**
 * The ONE reader of the org's pickup schedule + business timezone (Increment 28) — pure, unit-tested in
 * `org-schedule.spec.ts`.
 *
 * `AvailabilityService` (what the customer may book) and `AdminService` (what the founder is editing) both
 * resolve the schedule through this function. Two readers is how the console comes to show hours the
 * booking endpoint does not serve.
 */
import { DEFAULT_PICKUP_SCHEDULE, orgScheduleSchema, type OrgSchedule, type ScheduleSource } from '@blue-bee/shared';

/**
 * The business timezone when the org has not recorded one. Mirrors `OwnerService`'s `BUSINESS_TZ` so the
 * KPI day and the pickup day are the same day.
 */
export const FALLBACK_BUSINESS_TZ = 'America/Toronto';

export interface ResolvedSchedule {
  schedule: OrgSchedule;
  timezone: string;
  source: ScheduleSource;
}

/** The org's business timezone: `settings.tz` → env `OWNER_BUSINESS_TZ` → `America/Toronto`. */
export function resolveBusinessTz(org: { settings: unknown }): string {
  const cfg = (org.settings ?? {}) as Record<string, unknown>;
  const fromOrg = typeof cfg.tz === 'string' && cfg.tz.trim() !== '' ? cfg.tz : undefined;
  const fromEnv = process.env.OWNER_BUSINESS_TZ;
  const tz = fromOrg ?? (fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined) ?? FALLBACK_BUSINESS_TZ;
  // A bad IANA name would throw deep inside Intl at slot-generation time, with a stack that says nothing
  // about org config. Fail here, naming the culprit.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`Configured business timezone "${tz}" is not a valid IANA timezone`);
  }
  return tz;
}

/**
 * The org's effective pickup schedule, and whether it is the founder's or the built-in default.
 *
 * An UNPARSEABLE stored schedule falls back to the default and reports `source: 'default'` rather than
 * throwing. The reasoning: `PATCH /v1/admin/settings/schedule` validates against this same schema, so the
 * only way to store an invalid one is a hand-edit of the DB. Throwing would take booking down org-wide for
 * every customer; falling back keeps bookings flowing, and because the fallback is honestly labelled
 * `'default'`, neither the app nor the console can present it as the founder's saved hours.
 */
export function resolveOrgSchedule(org: { settings: unknown }): ResolvedSchedule {
  const timezone = resolveBusinessTz(org);
  const cfg = (org.settings ?? {}) as Record<string, unknown>;
  const parsed = orgScheduleSchema.safeParse(cfg.schedule);
  if (!parsed.success) {
    return { schedule: DEFAULT_PICKUP_SCHEDULE, timezone, source: 'default' };
  }
  return { schedule: parsed.data, timezone, source: 'org' };
}

/**
 * Merge a new schedule into `settings` without disturbing the sibling keys (`region`, `currency`, `tz`) the
 * bootstrap wrote. Returns a plain object so Prisma accepts it as `InputJsonValue`.
 */
export function withSchedule(settings: unknown, schedule: OrgSchedule): Record<string, unknown> {
  const base = (settings ?? {}) as Record<string, unknown>;
  return { ...base, schedule };
}
