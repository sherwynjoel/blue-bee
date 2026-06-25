/**
 * Driver app contract (Increment 9) — the driver-self-scoped duty-loop surface that the Expo
 * driver app consumes. Increment 4 shipped the route/stop/shift endpoints "DRIVER-ready" but
 * authorized them to OWNER/DISPATCHER (ops) only; Increment 9 adds a thin, ADDITIVE, strictly
 * driver-self-scoped `/v1/driver/*` surface that delegates to those proven services (the §5.4
 * `RouteStopStateMachine` + the `ShiftService` lifecycle) — NO schema change, NO ops-endpoint change.
 *
 * The driver only ever sees/acts on THEIR OWN shift, route, and stops (PRD §8.1/§17.3/US-T5).
 */

/** One stop on the driver's route — the destination + its §5.4 status + ETA (Increment 7). */
export interface DriverStopView {
  id: string;
  seq: number;
  /** RouteStopKind — PICKUP | DELIVERY. */
  kind: string;
  /** RouteStopStatus — PENDING | EN_ROUTE | ARRIVED | IN_PROGRESS | COMPLETED | FAILED | SKIPPED. */
  status: string;
  orderId: string | null;
  /** The destination site (the stop's address). */
  siteName: string | null;
  address: string | null;
  /** Destination geo (WGS84) for the map + native-nav hand-off; null if the site has no geo. */
  lat: number | null;
  lng: number | null;
  /** Service time window, if set (ISO-8601). */
  timeWindow: { start: string; end: string } | null;
  /** Smoothed point ETA + surfaced range (Increment 7, ISO-8601); null until computed. */
  eta: string | null;
  etaLow: string | null;
  etaHigh: string | null;
  /** Reason code, when the stop was FAILED/SKIPPED. */
  exceptionReason: string | null;
}

/** The driver's assigned route for the day, stops in optimized sequence. */
export interface DriverRouteView {
  id: string;
  /** Route date (ISO-8601). */
  date: string;
  /** RouteStatus — PUBLISHED | IN_PROGRESS | … */
  status: string;
  stops: DriverStopView[];
}

/** The driver's current shift (the GPS-emission gate — location streams only while ACTIVE). */
export interface DriverShiftView {
  id: string;
  /** ShiftStatus — SCHEDULED | ACTIVE | ENDED. */
  status: string;
  vehicleId: string;
  vehicleLabel: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/**
 * GET /v1/driver/assignment — everything the duty loop needs in one read: the driver's current
 * shift (ACTIVE, else the next SCHEDULED) and the workable route assigned to them, with ordered
 * stops. `shift`/`route` are null when nothing is assigned. The `shift.status` gates GPS emission.
 */
export interface DriverAssignment {
  driverId: string;
  shift: DriverShiftView | null;
  route: DriverRouteView | null;
}

/** The §5.4 stop actions a driver drives from the app (POST /v1/driver/stops/:id/<action>). */
export const DRIVER_STOP_ACTIONS = ['depart', 'arrive', 'start', 'complete', 'fail', 'skip'] as const;
export type DriverStopAction = (typeof DRIVER_STOP_ACTIONS)[number];

/** fail / skip require a reason code (mirrors the §5.4 exception contract). */
export const DRIVER_EXCEPTION_ACTIONS = ['fail', 'skip'] as const;

/** Stable error codes for the driver surface (problem+json `error`/`title`). */
export const DRIVER_ERRORS = {
  PROFILE_MISSING: 'driver.profile_missing',
  NOT_OWN_SHIFT: 'driver.not_own_shift',
  NOT_OWN_STOP: 'driver.not_own_stop',
} as const;
export type DriverErrorCode = (typeof DRIVER_ERRORS)[keyof typeof DRIVER_ERRORS];
