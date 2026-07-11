/**
 * Notifications contract (Increment 8) — the §8.5/§17.2 notification engine: event-type
 * constants that drive the event→channel matrix, plus the Zod request schema + DTO/response
 * types for the device-token registration surface (`POST/DELETE /v1/device-tokens`, §11.2).
 *
 * The engine consumes the durable GeofenceEvent rows + the `eta`/`geofence` realtime events from
 * Increment 7 and delivers customer alerts (push + SMS + email) behind a swappable transport seam
 * (Twilio / SendGrid / Expo — §10.x/§11.2). EN only this phase (FR localization is P2).
 */
import { z } from 'zod';
import { DevicePlatform } from './enums';

// ───────────────────────────── event types (drive the §17.2 matrix) ─────────────────────────────

/**
 * Canonical notification event types. The §17.2 event→channel matrix is keyed by these, so adding
 * another matrix row (booking confirmed, quote ready, picked up, delivered+POD, invoice, …) is
 * configuration, not new engine code. Increment 8 ships the two geofence-driven customer alerts
 * (§6.4 US-T2: "truck ~5 min away" + "arrived"); the rest are reserved for their own increments.
 */
export const NOTIFICATION_EVENTS = {
  GEOFENCE_APPROACHING: 'geofence.approaching',
  GEOFENCE_ARRIVED: 'geofence.arrived',
  // Payments / billing (Increment 12). Receipt + dunning go to the owning customer; a dispute
  // alert goes to org owner/finance staff (recipient scoping differs per event — see the engine).
  PAYMENT_RECEIPT: 'payment.receipt',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_DISPUTE: 'payment.dispute',
  // Ratings / CSAT (Increment 32). Fired once when an order reaches DELIVERED — invites the owning
  // customer to rate the completed order (deep-links to the Rate screen). Recipient = owning customer.
  RATE_REQUEST: 'rating.request',
} as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

// ───────────────────────────── device-token registration (POST/DELETE /v1/device-tokens) ─────────────────────────────

/**
 * A client app registering a push-delivery target for the authenticated user. The token is the
 * provider push token (Expo this phase). Idempotent by token: re-registering the same token
 * re-activates it + (re)assigns it to the current user (one physical device = one token).
 */
export const registerDeviceTokenSchema = z.object({
  token: z.string().min(1).max(512),
  platform: z.nativeEnum(DevicePlatform),
});
export type RegisterDeviceTokenDto = z.infer<typeof registerDeviceTokenSchema>;

/** Unregister (deactivate) a previously-registered token. */
export const unregisterDeviceTokenSchema = z.object({
  token: z.string().min(1).max(512),
});
export type UnregisterDeviceTokenDto = z.infer<typeof unregisterDeviceTokenSchema>;

/** The persisted device-token registration (response shape; never leaks another user's tokens). */
export interface DeviceTokenResult {
  id: string;
  platform: DevicePlatform;
  token: string;
  active: boolean;
  createdAt: string;
}

/** Stable error codes for the device-token endpoints (problem+json `error`). */
export const DEVICE_TOKEN_ERRORS = {
  TOKEN_NOT_FOUND: 'device_token.not_found',
} as const;
