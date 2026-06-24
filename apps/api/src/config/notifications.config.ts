/**
 * Typed notification configuration (Increment 8) — the §8.5/§17.2 notification engine. Every
 * tunable is config-driven (the Increment-3 "no magic literals" lesson): the event→channel matrix,
 * the urgent-event set, retry/backoff bounds, the quiet-hours policy, and the transport provider
 * selection all come from the environment. Reuses the existing TWILIO_* (SMS) from Increment 2.
 *
 * Provided + exported by NotificationsModule via `{ provide: NOTIFICATIONS_CONFIG, useFactory:
 * loadNotificationsConfig }`, mirroring AUTH_CONFIG / TRACKING_CONFIG.
 */
import { CommsChannel, NOTIFICATION_EVENTS } from '@blue-bee/shared';

export const NOTIFICATIONS_CONFIG = Symbol('NOTIFICATIONS_CONFIG');

/** What happens to a NON-urgent event raised inside a recipient's quiet-hours window. */
export type QuietHoursPolicy = 'defer' | 'suppress';

export interface NotificationsConfig {
  /** Human app name used in rendered templates ("Blue Bee"). */
  appName: string;
  /**
   * The §17.2 event→channel matrix: event type → the ORDERED channels to deliver on. Drives the
   * whole engine; adding a row is config, not code. Per-event overridable via
   * `NOTIF_MATRIX_<EVENT_KEY>="PUSH,SMS,EMAIL"`.
   */
  matrix: Record<string, CommsChannel[]>;
  /** Event types that BYPASS quiet-hours deferral (time-critical — the geofence alerts by default). */
  urgentEventTypes: Set<string>;
  quietHours: {
    /** Non-urgent event inside the window ⇒ defer to the window's end, or suppress entirely. */
    policy: QuietHoursPolicy;
    /** Fallback IANA timezone for a recipient whose preference row carries none (rare). */
    defaultTimezone: string;
  };
  retry: {
    /** Total transport attempts before a notification lands FAILED. */
    maxAttempts: number;
    /** Base backoff between attempts (ms); the Nth retry waits backoffMs × N (linear, bounded). */
    backoffMs: number;
    /** Per-attempt transport timeout (ms) — a hung provider can never stall the ingest path. */
    sendTimeoutMs: number;
    /** Background drain scan period (ms) for due PENDING/RETRYING rows. 0 ⇒ disabled (dev/test drive
     *  the drain explicitly; prod sets e.g. 2000–5000 so alerts go out promptly). */
    scanIntervalMs: number;
    /** On enqueue, kick a one-off drain OFF the request thread so alerts send promptly without the
     *  ingest path ever awaiting a transport. Default true; tests disable it to drain deterministically. */
    kickOnDispatch: boolean;
  };
  email: {
    /** SendGrid sandbox mode (validate + 200, NO delivery). Default true everywhere but prod-live. */
    sandbox: boolean;
    /** SendGrid API key; when absent the email transport falls back to the local console impl. */
    apiKey: string | null;
    fromEmail: string;
    fromName: string;
  };
  push: {
    /** Transport selector: 'expo' (real Expo Push API) or 'console' (real local impl, dev/test). */
    transport: 'expo' | 'console';
    /** Optional Expo access token (recommended for enhanced push security; sends work without it). */
    accessToken: string | null;
  };
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

function nullableStr(name: string): string | null {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : null;
}

function intPositive(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function intNonNeg(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

/** Parse a "PUSH,SMS,EMAIL" CSV into a de-duped, ordered, VALID CommsChannel list. */
function parseChannels(raw: string | null, fallback: CommsChannel[]): CommsChannel[] {
  if (!raw) return fallback;
  const valid = new Set(Object.values(CommsChannel) as string[]);
  const seen = new Set<string>();
  const out: CommsChannel[] = [];
  for (const tok of raw.split(',').map((t) => t.trim().toUpperCase())) {
    if (valid.has(tok) && !seen.has(tok)) {
      seen.add(tok);
      out.push(tok as CommsChannel);
    }
  }
  return out.length > 0 ? out : fallback;
}

/** Parse a CSV of event types into a trimmed set. */
function parseEventSet(raw: string | null, fallback: string[]): Set<string> {
  const list = raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : fallback;
  return new Set(list.length > 0 ? list : fallback);
}

export function loadNotificationsConfig(): NotificationsConfig {
  // §17.2 baseline for the two geofence customer alerts (§6.4 US-T2). The PRD row is Push+SMS; we
  // additionally deliver Email (a durable confirmation) — configurable per event via NOTIF_MATRIX_*.
  const defaultGeofenceChannels: CommsChannel[] = [CommsChannel.PUSH, CommsChannel.SMS, CommsChannel.EMAIL];
  const matrix: Record<string, CommsChannel[]> = {
    [NOTIFICATION_EVENTS.GEOFENCE_APPROACHING]: parseChannels(
      nullableStr('NOTIF_MATRIX_GEOFENCE_APPROACHING'),
      defaultGeofenceChannels,
    ),
    [NOTIFICATION_EVENTS.GEOFENCE_ARRIVED]: parseChannels(
      nullableStr('NOTIF_MATRIX_GEOFENCE_ARRIVED'),
      defaultGeofenceChannels,
    ),
  };

  return {
    appName: str('NOTIF_APP_NAME', 'Blue Bee'),
    matrix,
    urgentEventTypes: parseEventSet(nullableStr('NOTIF_URGENT_EVENT_TYPES'), [
      NOTIFICATION_EVENTS.GEOFENCE_APPROACHING,
      NOTIFICATION_EVENTS.GEOFENCE_ARRIVED,
    ]),
    quietHours: {
      policy: str('NOTIF_QUIET_HOURS_POLICY', 'defer') === 'suppress' ? 'suppress' : 'defer',
      defaultTimezone: str('NOTIF_DEFAULT_TIMEZONE', 'America/Toronto'),
    },
    retry: {
      maxAttempts: intPositive('NOTIF_MAX_ATTEMPTS', 3),
      backoffMs: intPositive('NOTIF_RETRY_BACKOFF_MS', 60_000),
      sendTimeoutMs: intPositive('NOTIF_SEND_TIMEOUT_MS', 8_000),
      scanIntervalMs: intNonNeg('NOTIF_RETRY_SCAN_MS', 0),
      kickOnDispatch: bool('NOTIF_KICK_ON_DISPATCH', true),
    },
    email: {
      sandbox: bool('SENDGRID_SANDBOX', true),
      apiKey: nullableStr('SENDGRID_API_KEY'),
      fromEmail: str('SENDGRID_FROM_EMAIL', str('EMAIL_FROM', 'no-reply@bluebee.example')),
      fromName: str('SENDGRID_FROM_NAME', 'Blue Bee'),
    },
    push: {
      transport: str('PUSH_TRANSPORT', 'console') === 'expo' ? 'expo' : 'console',
      accessToken: nullableStr('EXPO_ACCESS_TOKEN'),
    },
  };
}
