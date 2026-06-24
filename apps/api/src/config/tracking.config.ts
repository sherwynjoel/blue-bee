/**
 * Typed tracking configuration (Increment 7) — the ETA estimator + geofence thresholds, read
 * once from the environment (PRD §6.2/§6.4). Every tunable is config-driven (the Increment-3
 * "no magic literals" lesson): nothing about the ETA math or the geofence radii is hardcoded.
 *
 * Provided + exported by TrackingModule via `{ provide: TRACKING_CONFIG, useFactory:
 * loadTrackingConfig }`, mirroring the AUTH_CONFIG pattern.
 */

export const TRACKING_CONFIG = Symbol('TRACKING_CONFIG');

export interface EtaConfig {
  /** Road-circuity multiplier on the straight-line geodesic distance (≈1.3 ⇒ +30% for streets). */
  circuityFactor: number;
  /** Urban-average fallback speed when there's insufficient movement to derive one (km/h). */
  defaultSpeedKmh: number;
  /** Lower clamp on the derived speed — a crawling truck never yields an absurd ETA (km/h). */
  speedFloorKmh: number;
  /** Upper clamp on the derived speed — a GPS jump never yields a near-zero ETA (km/h). */
  speedCeilKmh: number;
  /** EWMA weight on the freshest estimate (0..1]; lower ⇒ smoother, higher ⇒ more responsive. */
  smoothingAlpha: number;
  /** Half-width of the surfaced ETA range as a fraction of the mid (0.2 ⇒ ±20%). */
  rangePct: number;
  /** Hard cap on the ETA (seconds) — no unbounded ETA on a far/slow estimate. */
  maxEtaSeconds: number;
  /** How many recent pings to derive speed from (distance/time across the last N advances). */
  recentPingSampleSize: number;
  /** Below this total path movement over the sample window ⇒ stationary/noise ⇒ speed fallback (m). */
  minMovementMeters: number;
  /** Optional extra throttle on top of CAS-advance gating: skip recompute if the last one was
   *  newer than this many seconds ago. 0 ⇒ recompute on every genuine advance (CAS is the sampling). */
  recomputeMinIntervalSec: number;
}

export interface GeofenceConfig {
  /** `approaching` fires when the vehicle is within this distance of the stop (m). */
  approachingRadiusM: number;
  /** …OR when the computed ETA drops to/below this many seconds (whichever happens first). */
  approachingEtaSec: number;
  /** `arrived` fires when the vehicle is within this tighter distance of the stop (m). */
  arrivedRadiusM: number;
}

export interface TrackingConfig {
  eta: EtaConfig;
  geofence: GeofenceConfig;
}

/** Parse a finite number from the environment, falling back when unset/invalid. */
function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A positive number (> 0) — guards against a divide-by-zero speed/sample from a bad env value. */
function positive(name: string, fallback: number): number {
  const n = num(name, fallback);
  return n > 0 ? n : fallback;
}

/** A fraction clamped to (0, 1] — for the EWMA alpha and range half-width. */
function fraction(name: string, fallback: number): number {
  const n = num(name, fallback);
  return n > 0 && n <= 1 ? n : fallback;
}

export function loadTrackingConfig(): TrackingConfig {
  const eta: EtaConfig = {
    circuityFactor: positive('ETA_CIRCUITY_FACTOR', 1.3),
    defaultSpeedKmh: positive('ETA_DEFAULT_SPEED_KMH', 30),
    speedFloorKmh: positive('ETA_SPEED_FLOOR_KMH', 5),
    speedCeilKmh: positive('ETA_SPEED_CEIL_KMH', 90),
    smoothingAlpha: fraction('ETA_SMOOTHING_ALPHA', 0.5),
    rangePct: fraction('ETA_RANGE_PCT', 0.2),
    maxEtaSeconds: positive('ETA_MAX_SECONDS', 14_400),
    recentPingSampleSize: Math.max(2, Math.floor(positive('ETA_RECENT_PING_SAMPLE', 5))),
    minMovementMeters: Math.max(0, num('ETA_MIN_MOVEMENT_M', 15)),
    recomputeMinIntervalSec: Math.max(0, num('ETA_RECOMPUTE_MIN_INTERVAL_SEC', 0)),
  };
  // Keep the floor ≤ ceil even if mis-configured, so the clamp window is always valid.
  if (eta.speedFloorKmh > eta.speedCeilKmh) {
    const lo = eta.speedCeilKmh;
    eta.speedCeilKmh = eta.speedFloorKmh;
    eta.speedFloorKmh = lo;
  }
  const geofence: GeofenceConfig = {
    approachingRadiusM: positive('GEOFENCE_APPROACHING_RADIUS_M', 800),
    approachingEtaSec: positive('GEOFENCE_APPROACHING_ETA_SEC', 300),
    arrivedRadiusM: positive('GEOFENCE_ARRIVED_RADIUS_M', 100),
  };
  return { eta, geofence };
}
