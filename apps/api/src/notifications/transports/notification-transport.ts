import type { CommsChannel } from '@blue-bee/shared';

/**
 * The swappable transport seam (PRD §10.x/§11.2) — one real adapter per channel. Twilio (SMS),
 * SendGrid (email), and Expo (push) are the first adapters; MessageBird/SES/native FCM-APNs swap in
 * later without touching the engine. A channel with no provider credentials falls back to a REAL
 * local "console" adapter (the Increment-2 pattern — it logs + returns a synthetic id, NOT a mock),
 * so the whole engine is exercisable end-to-end without external creds.
 */

/** The rendered, channel-shaped message the engine hands a transport. */
export interface OutgoingMessage {
  /** Destination addresses for this channel: phone(s) (SMS), email(s) (email), or push token(s). */
  recipients: string[];
  /** Email subject. */
  subject?: string;
  /** Push notification title. */
  title?: string;
  /** The message body (all channels). */
  body: string;
  /**
   * Optional structured data delivered alongside a PUSH (ignored by SMS/email). Carries the
   * `orderId` (+ event `type`) so a tapped push deep-links the customer app to THAT order's tracking
   * (Increment 11) — the push payload is the only channel that can carry it (the realtime WS
   * `geofence` event carries it while the app is foregrounded). Values are strings (Expo data shape).
   */
  data?: Record<string, string>;
}

/** What a transport returns on a successful accept. */
export interface TransportResult {
  /** Provider-side accepted-message id: Twilio SID / SendGrid x-message-id / Expo ticket id. */
  providerMessageId?: string;
}

/** A real send adapter for one channel. `send` throws on a provider/transport failure (→ retry). */
export interface NotificationTransport {
  readonly channel: CommsChannel;
  /** Stable identifier for logs/audit, e.g. `sms:twilio`, `email:sendgrid`, `push:expo`. */
  readonly name: string;
  send(msg: OutgoingMessage): Promise<TransportResult>;
}

/** DI token for the channel→transport registry (a Map), assembled in NotificationsModule. */
export const NOTIFICATION_TRANSPORTS = Symbol('NOTIFICATION_TRANSPORTS');
export type TransportRegistry = Map<CommsChannel, NotificationTransport>;
