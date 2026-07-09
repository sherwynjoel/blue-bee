/**
 * Tracking contract (Increment 5) — Zod request schemas + DTO/response types for the
 * location ingestion + storage data path (PRD §6.2 tracking architecture, §10.4 real-time
 * location path, §9.5 GpsPing/Shift, §11.1 `POST /locations:batch`, `GET /fleet/live`,
 * `GET /orders/:id/tracking`, §12.2 privacy scoping).
 *
 * Scope of Increment 5 here is INGESTION + STORAGE + scoped REST reads. Increment 6 added the
 * realtime channels (Socket.IO/WS) + the signed channel token. Increment 7 (this file's `eta`/
 * `geofence` WS events, `StopEta`, and the ETA-range fields on the REST reads) adds server-side
 * ETA + geofence evaluation — computed in-house behind an estimator seam, NO external maps API,
 * NO notification delivery (the durable GeofenceEvent row + the WS event ARE the triggers a later
 * notifications increment consumes).
 */
import { z } from 'zod';

// ───────────────────────────── location ingestion (POST /v1/locations:batch) ─────────────────────────────

/**
 * A single GPS ping from a driver device (PRD §9.5 GpsPing). `recordedAt` is the device
 * capture time and is AUTHORITATIVE for "latest" — arrival order is irrelevant. Coordinates
 * are WGS84 lat/lng; out-of-range values are rejected (problem+json 400) before any store
 * write. speed (m/s, ≥0) and heading (degrees, [0,360]) are optional sensor fields.
 */
export const gpsPingSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speed: z.number().nonnegative().max(1000).optional(),
  heading: z.number().min(0).max(360).optional(),
  /** ISO-8601 device capture timestamp (authoritative for last-known ordering). */
  recordedAt: z.string().datetime(),
});
export type GpsPingDto = z.infer<typeof gpsPingSchema>;

/**
 * A batch of pings for ONE active shift + vehicle (one driver device = one shift/vehicle).
 * Batched + idempotent: replays and duplicate (vehicleId, recordedAt) pings are deduped
 * (§6.2 robust ingestion). Bounded to keep a single ingest request cheap.
 */
export const locationBatchSchema = z.object({
  shiftId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  pings: z.array(gpsPingSchema).min(1).max(1000),
});
export type LocationBatchDto = z.infer<typeof locationBatchSchema>;

// ───────────────────────────── read shapes (responses) ─────────────────────────────

/** A vehicle's last-known position, from the Redis hot store or the Timescale fallback. */
export interface LastKnownPosition {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  /** Device capture time of this position (ISO-8601). */
  recordedAt: string;
  /** Seconds since `recordedAt` (freshness; computed at read time). */
  ageSeconds: number;
  /** Which store served this row — the Redis hot last-known, or the Timescale fallback. */
  source: 'redis' | 'timescale';
}

/** POST /v1/locations:batch result — proves what was accepted vs deduped vs appended. */
export interface LocationBatchResult {
  vehicleId: string;
  shiftId: string;
  /** Pings in the request body. */
  received: number;
  /** Pings remaining after in-batch dedup by (vehicleId, recordedAt). */
  accepted: number;
  /** Rows actually appended to the Timescale hypertable (0 on a full replay). */
  inserted: number;
  /** True when this batch advanced the Redis last-known (false if every ping was stale). */
  lastKnownUpdated: boolean;
  /** The vehicle's last-known after this batch (newest by recordedAt). */
  lastKnown: LastKnownPosition | null;
}

/**
 * A computed server-side ETA snapshot for one stop (PRD §6.2 — "server-computed from current
 * position → next stop … smoothed … surfaced as a RANGE"). Computed in-house behind the
 * `EtaEstimator` seam (Increment 7); NO external maps/routing API.
 *
 * `eta` is the smoothed point ("mid") arrival time; `low`/`high` bound the surfaced range. All
 * three are ISO-8601 ABSOLUTE target arrival times (so a client renders them without a clock
 * skew assumption). `etaSeconds` is the mid seconds-remaining at `computedAt` (>= 0, capped).
 */
export interface StopEta {
  stopId: string;
  /** Smoothed point ("mid") arrival — ISO-8601 absolute time. */
  eta: string;
  /** Lower bound of the surfaced range — ISO-8601 absolute time. */
  low: string;
  /** Upper bound of the surfaced range — ISO-8601 absolute time. */
  high: string;
  /** Mid seconds-remaining at compute time (>= 0, capped to the configured max). */
  etaSeconds: number;
  /** When the estimate was computed — ISO-8601. */
  computedAt: string;
}

/** GET /v1/fleet/live result — all the caller-org's vehicles' last-known (owner/dispatch/CSR). */
export interface FleetLiveResult {
  /**
   * Each positioned vehicle's last-known + its `nextStopEta` (the persisted ETA for the vehicle's
   * current active EN_ROUTE/ARRIVED stop, Increment 7) — `null` when the vehicle has no active
   * stop with a computed ETA.
   */
  vehicles: Array<LastKnownPosition & { label: string; nextStopEta: StopEta | null }>;
  /** Vehicles in the org with no position yet (never pinged). */
  withoutPosition: Array<{ vehicleId: string; label: string }>;
}

/**
 * GET /v1/orders/:id/tracking result — the customer "track my truck" poll. Returns the
 * last-known of EXACTLY the one vehicle assigned to the order's active stop, scoped to the
 * owning customer (§6.2 privacy: one vehicle, never any other). `vehicle` is null when no
 * stop is currently active / no vehicle is assigned / it has no position yet.
 *
 * `channelToken` (Increment 6) is the short-lived, server-signed capability to open the live
 * WS channel `WS /live/vehicle` for THIS one vehicle/stop (PRD §11.1). Null when there is no
 * active stop / no assigned vehicle to track. The token is the ONLY way a customer opens a
 * live channel; its scope (one vehicle) and lifetime (the active-stop window) are enforced
 * server-side at the WS handshake.
 */
export interface OrderTrackingResult {
  orderId: string;
  /**
   * The order's active route stop (the one being worked / next up), if any. `eta` is the
   * smoothed point ETA and `etaLow`/`etaHigh`/`etaComputedAt` the surfaced range + freshness
   * (Increment 7, ISO-8601) — all null until an ETA has been computed (stop EN_ROUTE/ARRIVED with
   * a geo destination). Served on the REST read so the customer gets a first ETA paint before the
   * socket connects.
   */
  stop: {
    id: string;
    status: string;
    kind: string;
    eta: string | null;
    etaLow: string | null;
    etaHigh: string | null;
    etaComputedAt: string | null;
  } | null;
  vehicle: LastKnownPosition | null;
  channelToken: string | null;
}

// ───────────────────────────── realtime WS contract (Increment 6) ─────────────────────────────

/**
 * WS "paths" map to Socket.IO NAMESPACES (Socket.IO has no REST-style path params, so the
 * `:token` in `WS /live/vehicle/:token` is passed in the handshake `auth.token`, not the URL).
 *  • VEHICLE — customer channel; connect with `auth: { token: <channelToken> }`; the socket is
 *    server-bound to exactly the one vehicle's room (no client-side subscribe). PRD §6.2.
 *  • FLEET   — owner/dispatch channel; connect with `auth: { token: <access JWT> }`; bound to
 *    the caller-org fleet room (all org vehicles). PRD §6.1(b).
 */
export const WS_NAMESPACES = {
  VEHICLE: '/live/vehicle',
  FLEET: '/live/fleet',
} as const;

/** Server→client events on both channels. Subscription is server-bound; clients never emit. */
export const WS_EVENTS = {
  /** A new last-known position (emitted only on a genuine recorded_at advance). */
  POSITION: 'position',
  /**
   * A refreshed server-side ETA range for the customer's active stop (Increment 7). Emitted on
   * each genuine last-known advance, after EWMA smoothing. To the customer's STOP room (stop-
   * specific — never the shared vehicle room, so a co-routed customer on a different stop never
   * sees this stop's ETA) and the org fleet room. Payload: `LiveEtaEvent`.
   */
  ETA: 'eta',
  /**
   * A geofence crossing for the customer's active stop (Increment 7): `APPROACHING` (within the
   * configured radius OR ETA ≤ threshold) or `ARRIVED` (within the tight radius). Fires exactly
   * once per stop per type (idempotent). Advisory only — does NOT transition the §5.4 stop (the
   * driver stays authoritative). To the customer STOP room + org fleet room. Payload:
   * `LiveGeofenceEvent`.
   */
  GEOFENCE: 'geofence',
  /** The channel was closed server-side (stop ended / shift ended / token expired). */
  CHANNEL_CLOSED: 'channel:closed',
  /**
   * A new in-app chat message was persisted for the order (Increment 18). Emitted to the ORDER
   * room on the VEHICLE namespace, so exactly the order's customer + assigned driver (both bound
   * to that room, authorize-by-construction) receive it live. Payload: `ChatMessageEvent`
   * (messaging.ts). Like every WS event this is an OPTIMIZATION over the persisted REST history —
   * an offline/degraded client backfills via GET /v1/orders/:id/messages, never losing a message.
   */
  CHAT_MESSAGE: 'chat:message',
  /**
   * [Inc-22] A driver/plant-approved weight capture was recorded and the order re-priced. Emitted to the
   * org FLEET room (dashboard: live authoritative weight + computed price line) AND the order's ORDER room
   * on the VEHICLE namespace (the order's customer, server-bound). Payload: `LiveWeightEvent`. An
   * OPTIMIZATION over the REST source of truth — an offline client backfills via the order read.
   */
  WEIGHT: 'weight',
} as const;

/**
 * [Inc-22] Payload of a `weight` event — a driver/plant weight was approved and the order re-priced.
 * `pricingStatus` mirrors what the pricing gate did: `auto_approved` (all-FIXED lines auto-priced at the
 * published rate) or `quote_sent` (a FROM_MEASURED specialty line awaits customer approval). `priceTotal`
 * is the quote total (decimal string) or null if not yet priced.
 */
export interface LiveWeightEvent {
  orderId: string;
  itemId: string | null;
  weightKg: string;
  weighPoint: 'PICKUP' | 'PLANT';
  authoritativeWeightKg: string;
  capturedAt: string;
  pricingStatus: 'auto_approved' | 'quote_sent' | 'none';
  priceTotal: string | null;
  currency: string;
}

/** Payload of a `position` event — one vehicle's live position. */
export interface LivePositionEvent {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
}

/**
 * Payload of an `eta` event (Increment 7) — the smoothed ETA range for one vehicle's active stop.
 * Extends `StopEta` with the vehicle/order context the fleet console needs to attribute it.
 */
export interface LiveEtaEvent extends StopEta {
  vehicleId: string;
  orderId: string | null;
}

/**
 * Payload of a `geofence` event (Increment 7) — one geofence crossing. `type` is the §9.5
 * `GeofenceEventType` (only `APPROACHING`/`ARRIVED` are emitted this phase; `DEPARTED` is modeled
 * but not emitted). `occurredAt` is when the crossing was detected (ISO-8601).
 */
export interface LiveGeofenceEvent {
  vehicleId: string;
  stopId: string;
  orderId: string | null;
  type: 'APPROACHING' | 'ARRIVED';
  occurredAt: string;
}

export type ChannelClosedReason =
  | 'stop_completed'
  | 'stop_failed'
  | 'stop_skipped'
  | 'stop_reassigned'
  | 'shift_ended'
  | 'token_expired';

/** Payload of a `channel:closed` event sent just before a server-side disconnect. */
export interface ChannelClosedEvent {
  reason: ChannelClosedReason;
  vehicleId: string;
  stopId?: string;
}

/**
 * Claims in the signed customer channel token (dedicated secret; HS256 JWT). `kind` pins it
 * to the tracking capability so it can never be confused with an auth/session token.
 */
export interface ChannelTokenClaims {
  kind: 'vehicle-tracking';
  org_id: string;
  vehicle_id: string;
  order_id: string;
  stop_id: string;
  /** The principal who minted it (audit). */
  sub: string;
  /**
   * Inc-18: chat authorization. Present + true ONLY on a token minted by the participant-gated chat
   * channel endpoint (GET /v1/orders/:id/messages/channel), which proves the caller is the order's
   * customer or its assigned driver. The gateway joins the order chat room ONLY for chat:true tokens,
   * so a plain tracking token (minted by GET /orders/:id/tracking, which org-wide staff may call) can
   * observe the vehicle but NEVER receives chat — chat stays scoped to exactly the two participants.
   */
  chat?: boolean;
  iat?: number;
  exp?: number;
}

// ───────────────────────────── error codes (problem+json title) ─────────────────────────────

export const TRACKING_ERRORS = {
  SHIFT_NOT_FOUND: 'shift_not_found',
  SHIFT_NOT_ACTIVE: 'shift_not_active',
  VEHICLE_MISMATCH: 'vehicle_shift_mismatch',
  NOT_OWN_SHIFT: 'not_own_shift',
  DRIVER_PROFILE_MISSING: 'driver_profile_missing',
  ORDER_NOT_FOUND: 'order_not_found',
} as const;
export type TrackingErrorCode = (typeof TRACKING_ERRORS)[keyof typeof TRACKING_ERRORS];
