import type { EtaConfig } from '../config/tracking.config';

/**
 * Pure ETA math (Increment 7) — no DB, no Redis, no clock — so the estimator's brain is unit-
 * testable in isolation: distance×circuity÷speed, derived-speed + fallback, EWMA smoothing,
 * range, stationary, and caps. The injectable estimator (`PostgisEtaEstimator`) wires the
 * vehicle→stop "remaining distance" (PostGIS `ST_Distance` geography) to these functions.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}
export interface TrackPoint extends GeoPoint {
  /** Device capture time (ms epoch) — the time axis for the derived speed. */
  recordedAtMs: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two WGS84 points (metres). Used ONLY to derive ground speed from
 * the recent track; the vehicle→stop "remaining distance" uses PostGIS `ST_Distance` (geodesic),
 * matching the in-house route sequencer.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Derive ground speed (km/h) from the recent track — total path length over total elapsed time
 * across the last N pings. Returns null when there's insufficient signal to trust a speed:
 * fewer than 2 points, a non-positive time span (all same instant), or total movement below
 * `minMovementMeters` (stationary / GPS noise). On null the caller falls back to the configured
 * urban average — so a parked or first-ping vehicle never divides by ~0 to an absurd ETA.
 */
export function deriveSpeedKmh(points: TrackPoint[], minMovementMeters: number): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.recordedAtMs - b.recordedAtMs);
  let pathMeters = 0;
  for (let i = 1; i < sorted.length; i++) pathMeters += haversineMeters(sorted[i - 1], sorted[i]);
  const elapsedSec = (sorted[sorted.length - 1].recordedAtMs - sorted[0].recordedAtMs) / 1000;
  if (elapsedSec <= 0) return null; // all the same instant — no usable time base
  if (pathMeters < minMovementMeters) return null; // stationary / noise → fallback
  return (pathMeters / elapsedSec) * 3.6;
}

export type EtaMethod = 'derived' | 'default-speed';

/**
 * Clamp a derived speed into the configured [floor, ceil]; fall back to the urban average when
 * none could be derived. Returns the speed actually used + which method produced it. The floor is
 * always > 0 (config-guaranteed), so the downstream divide can never blow up.
 */
export function resolveSpeedKmh(rawKmh: number | null, cfg: EtaConfig): { speedKmh: number; method: EtaMethod } {
  if (rawKmh === null) return { speedKmh: cfg.defaultSpeedKmh, method: 'default-speed' };
  const clamped = Math.min(cfg.speedCeilKmh, Math.max(cfg.speedFloorKmh, rawKmh));
  return { speedKmh: clamped, method: 'derived' };
}

export interface EtaMathResult {
  /** Smoothed mid seconds-remaining (>= 0, capped). */
  etaSeconds: number;
  /** Range bounds (seconds-remaining). */
  lowSeconds: number;
  highSeconds: number;
}

/**
 * Turn a remaining distance + a speed into a smoothed ETA range (seconds).
 *  • raw = distance × circuity ÷ speed   (metres ÷ metres-per-second)
 *  • EWMA against the prior estimate, AGED by the elapsed time since it was computed — using the
 *    absolute prior target (`prevTargetMs`) so the memory term decays on its own. This kills
 *    jitter WITHOUT lagging the natural shrink as the truck closes in: whenever the fresh raw is
 *    below the prior (distance fell), the aging term guarantees the new mid is below the prior too.
 *  • capped at `maxEtaSeconds`, floored at 0; range = mid ± rangePct (high also capped).
 * Pure + deterministic — `computeNowMs` is injected, never read from the clock.
 */
export function computeEta(args: {
  distanceMeters: number;
  speedKmh: number;
  cfg: EtaConfig;
  prevTargetMs: number | null;
  computeNowMs: number;
}): EtaMathResult {
  const { distanceMeters, speedKmh, cfg, prevTargetMs, computeNowMs } = args;
  const speedMs = speedKmh / 3.6; // speedKmh is > 0 (resolveSpeedKmh floors it) — no divide-by-zero
  const rawSeconds = (Math.max(0, distanceMeters) * cfg.circuityFactor) / speedMs;

  let mid: number;
  if (prevTargetMs !== null) {
    const agedPrevRemaining = Math.max(0, (prevTargetMs - computeNowMs) / 1000);
    mid = cfg.smoothingAlpha * rawSeconds + (1 - cfg.smoothingAlpha) * agedPrevRemaining;
  } else {
    mid = rawSeconds; // first compute — no memory to blend
  }
  mid = Math.min(cfg.maxEtaSeconds, Math.max(0, mid));
  const lowSeconds = Math.max(0, mid * (1 - cfg.rangePct));
  const highSeconds = Math.min(cfg.maxEtaSeconds, mid * (1 + cfg.rangePct));
  return { etaSeconds: mid, lowSeconds, highSeconds };
}
