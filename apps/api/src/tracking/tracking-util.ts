import { RouteStatus, RouteStopStatus, type GpsPingDto, type LastKnownPosition } from '@blue-bee/shared';

/**
 * Pure helpers for the tracking data path — no DB/Redis — so the tricky ordering/dedup/
 * privacy-selection logic is unit-testable in isolation. The services compose these.
 */

/** A ping after in-batch dedup, normalized for storage (recorded_at parsed; sensors → null). */
export interface DedupedPing {
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: Date;
}

/**
 * Dedup a batch by recorded_at instant (a vehicle has one position per instant). Last
 * occurrence wins (a later duplicate in the same batch supersedes an earlier one). Returns
 * pings sorted ascending by recorded_at so the result is deterministic regardless of arrival
 * order (recorded_at is authoritative, §6.2).
 */
export function dedupePings(pings: GpsPingDto[]): DedupedPing[] {
  const byInstant = new Map<number, DedupedPing>();
  for (const p of pings) {
    const recordedAt = new Date(p.recordedAt);
    byInstant.set(recordedAt.getTime(), {
      lat: p.lat,
      lng: p.lng,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
      recordedAt,
    });
  }
  return [...byInstant.values()].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

/** The newest ping (max recorded_at) — the last-known candidate. Assumes a non-empty list. */
export function newestPing(rows: DedupedPing[]): DedupedPing {
  return rows.reduce((a, b) => (b.recordedAt.getTime() > a.recordedAt.getTime() ? b : a));
}

/** Routes whose stops are "live" (a vehicle is or will be moving against them). */
export const WORKABLE_ROUTE: ReadonlySet<RouteStatus> = new Set([RouteStatus.PUBLISHED, RouteStatus.IN_PROGRESS]);

/** Non-terminal stop statuses, ranked most-active → least (lower = more active). */
export const STOP_PRIORITY: Readonly<Record<string, number>> = {
  [RouteStopStatus.IN_PROGRESS]: 0,
  [RouteStopStatus.ARRIVED]: 1,
  [RouteStopStatus.EN_ROUTE]: 2,
  [RouteStopStatus.PENDING]: 3,
};

export interface SelectableStop {
  status: string;
  seq: number;
  route: { status: string; vehicleId: string | null };
}

/**
 * Pick the order's single active stop (privacy: exactly one vehicle, §6.2): the non-terminal
 * stop on a workable route that is most-progressed (IN_PROGRESS > ARRIVED > EN_ROUTE >
 * PENDING), tie-broken by sequence. Returns null when nothing is active.
 */
export function selectActiveStop<T extends SelectableStop>(stops: T[]): T | null {
  const candidates = stops.filter(
    (s) => WORKABLE_ROUTE.has(s.route.status as RouteStatus) && s.status in STOP_PRIORITY,
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const pa = STOP_PRIORITY[a.status] ?? 99;
    const pb = STOP_PRIORITY[b.status] ?? 99;
    return pa !== pb ? pa - pb : a.seq - b.seq;
  })[0];
}

/**
 * Build a typed last-known from a Redis hash, computing freshness against `nowMs`. Returns
 * null when the hash is absent/empty (vehicle never pinged).
 */
export function parseLastKnownHash(
  vehicleId: string,
  hash: Record<string, string> | null | undefined,
  nowMs: number,
): LastKnownPosition | null {
  if (!hash || hash.recordedAtMs === undefined) return null;
  const recordedAtMs = Number(hash.recordedAtMs);
  return {
    vehicleId,
    lat: Number(hash.lat),
    lng: Number(hash.lng),
    speed: hash.speed === '' || hash.speed === undefined ? null : Number(hash.speed),
    heading: hash.heading === '' || hash.heading === undefined ? null : Number(hash.heading),
    recordedAt: hash.recordedAt,
    ageSeconds: Math.max(0, Math.floor((nowMs - recordedAtMs) / 1000)),
    source: 'redis',
  };
}
