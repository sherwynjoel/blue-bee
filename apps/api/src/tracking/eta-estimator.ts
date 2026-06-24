import type { EtaMethod, GeoPoint, TrackPoint } from './eta-math';

/**
 * The swappable ETA estimator seam (PRD §11.2/§10.2 — maps/routing is explicitly a provider
 * abstraction). Increment 7 binds it to the in-house `PostgisEtaEstimator`; a Google Routes /
 * Mapbox adapter can replace it later WITHOUT touching any caller — exactly as Increment 4's
 * sequencer sits behind the `RouteOptimizer` seam. NO external maps/routing API this increment.
 */
export const ETA_ESTIMATOR = Symbol('ETA_ESTIMATOR');

/** Inputs the estimator needs beyond the two endpoints. */
export interface EtaContext {
  /** Recent track (last N advances) — the basis for the derived ground speed. */
  recentPings: TrackPoint[];
  /** The prior persisted ETA target (ms epoch) — the EWMA memory; null on the first compute. */
  prevTargetMs: number | null;
  /** Server compute time (ms epoch) — injected so smoothing/range stay deterministic + testable. */
  computeNowMs: number;
}

export interface EtaResult {
  /** Smoothed mid seconds-remaining (>= 0, capped). */
  etaSeconds: number;
  /** Range bounds (seconds-remaining). */
  lowSeconds: number;
  highSeconds: number;
  /** Geodesic distance vehicle→stop (m) — reused by the geofence eval, so it isn't re-queried. */
  distanceMeters: number;
  /** The speed actually used (km/h) and how it was obtained (derived vs. urban-average fallback). */
  speedKmh: number;
  method: EtaMethod;
}

/** `estimate(from, to, ctx)` — the one method callers depend on. One real impl this increment. */
export interface EtaEstimator {
  readonly name: string;
  estimate(from: GeoPoint, to: GeoPoint, ctx: EtaContext): Promise<EtaResult>;
}
