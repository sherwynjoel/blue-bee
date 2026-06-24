/**
 * Tracking contract (Increment 5) — Zod request schemas + DTO/response types for the
 * location ingestion + storage data path (PRD §6.2 tracking architecture, §10.4 real-time
 * location path, §9.5 GpsPing/Shift, §11.1 `POST /locations:batch`, `GET /fleet/live`,
 * `GET /orders/:id/tracking`, §12.2 privacy scoping).
 *
 * Scope of this increment is INGESTION + STORAGE + scoped REST reads only — NO realtime
 * channels (Socket.IO/WS), NO server-side ETA, NO geofence evaluation, NO notifications.
 * Those are Increment 6. The customer "tracking" read here is a scoped poll of last-known
 * (the short-lived signed channel token + live WS stream land in Increment 6).
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

/** GET /v1/fleet/live result — all the caller-org's vehicles' last-known (owner/dispatch/CSR). */
export interface FleetLiveResult {
  vehicles: Array<LastKnownPosition & { label: string }>;
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
  /** The order's active route stop (the one being worked / next up), if any. */
  stop: { id: string; status: string; kind: string; eta: string | null } | null;
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
  /** The channel was closed server-side (stop ended / shift ended / token expired). */
  CHANNEL_CLOSED: 'channel:closed',
} as const;

/** Payload of a `position` event — one vehicle's live position. */
export interface LivePositionEvent {
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  recordedAt: string;
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
