import { CommsChannel, NOTIFICATION_EVENTS } from '@blue-bee/shared';
import { loadNotificationsConfig } from './notifications.config';

/** Save/restore only the keys a case touches (setup-env sets some NOTIF_* globally). */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('notifications config (Increment 8)', () => {
  it('defaults the geofence matrix to PUSH+SMS+EMAIL and flags both geofence events urgent', () => {
    withEnv(
      { NOTIF_MATRIX_GEOFENCE_APPROACHING: undefined, NOTIF_MATRIX_GEOFENCE_ARRIVED: undefined, NOTIF_URGENT_EVENT_TYPES: undefined },
      () => {
        const cfg = loadNotificationsConfig();
        expect(cfg.matrix[NOTIFICATION_EVENTS.GEOFENCE_APPROACHING]).toEqual([
          CommsChannel.PUSH,
          CommsChannel.SMS,
          CommsChannel.EMAIL,
        ]);
        expect(cfg.urgentEventTypes.has(NOTIFICATION_EVENTS.GEOFENCE_APPROACHING)).toBe(true);
        expect(cfg.urgentEventTypes.has(NOTIFICATION_EVENTS.GEOFENCE_ARRIVED)).toBe(true);
      },
    );
  });

  it('parses a per-event matrix override (de-duped, ordered, valid channels only)', () => {
    withEnv({ NOTIF_MATRIX_GEOFENCE_APPROACHING: 'sms, push, bogus, sms' }, () => {
      const cfg = loadNotificationsConfig();
      expect(cfg.matrix[NOTIFICATION_EVENTS.GEOFENCE_APPROACHING]).toEqual([CommsChannel.SMS, CommsChannel.PUSH]);
    });
  });

  it('falls back to the default channel set when an override is all-invalid', () => {
    withEnv({ NOTIF_MATRIX_GEOFENCE_ARRIVED: 'nonsense,,,' }, () => {
      const cfg = loadNotificationsConfig();
      expect(cfg.matrix[NOTIFICATION_EVENTS.GEOFENCE_ARRIVED].length).toBe(3);
    });
  });

  it('parses a custom urgent-event set', () => {
    withEnv({ NOTIF_URGENT_EVENT_TYPES: 'geofence.arrived' }, () => {
      const cfg = loadNotificationsConfig();
      expect(cfg.urgentEventTypes.has(NOTIFICATION_EVENTS.GEOFENCE_ARRIVED)).toBe(true);
      expect(cfg.urgentEventTypes.has(NOTIFICATION_EVENTS.GEOFENCE_APPROACHING)).toBe(false);
    });
  });

  it('email transport falls back to console when no SENDGRID_API_KEY; sandbox defaults on', () => {
    withEnv({ SENDGRID_API_KEY: undefined, SENDGRID_SANDBOX: undefined }, () => {
      const cfg = loadNotificationsConfig();
      expect(cfg.email.apiKey).toBeNull();
      expect(cfg.email.sandbox).toBe(true);
    });
  });

  it('retry bounds + push transport selector read from env', () => {
    withEnv({ NOTIF_MAX_ATTEMPTS: '5', NOTIF_RETRY_BACKOFF_MS: '1234', PUSH_TRANSPORT: 'expo' }, () => {
      const cfg = loadNotificationsConfig();
      expect(cfg.retry.maxAttempts).toBe(5);
      expect(cfg.retry.backoffMs).toBe(1234);
      expect(cfg.push.transport).toBe('expo');
    });
  });
});
