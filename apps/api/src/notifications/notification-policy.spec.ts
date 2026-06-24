import { CommsChannel } from '@blue-bee/shared';
import { channelEnabled, decideChannel, type UserNotificationPref } from './notification-policy';

const TZ = 'America/Toronto';
// 22:30 local on 2026-06-24 (EDT) — inside a 22:00→07:00 quiet window.
const NIGHT = new Date('2026-06-24T02:30:00Z');
// 12:00 local — outside it.
const DAY = new Date('2026-06-24T16:00:00Z');

const quietPref: UserNotificationPref = {
  pushEnabled: true,
  smsEnabled: true,
  emailEnabled: true,
  quietHoursStart: 1320, // 22:00
  quietHoursEnd: 420, // 07:00
  timezone: TZ,
};

describe('notification policy — preferences + quiet hours (Increment 8)', () => {
  describe('channelEnabled', () => {
    it('absent pref ⇒ all channels on (default-on)', () => {
      expect(channelEnabled(null, CommsChannel.PUSH)).toBe(true);
      expect(channelEnabled(null, CommsChannel.SMS)).toBe(true);
      expect(channelEnabled(null, CommsChannel.EMAIL)).toBe(true);
    });
    it('honors per-channel opt-outs', () => {
      const pref = { ...quietPref, smsEnabled: false };
      expect(channelEnabled(pref, CommsChannel.SMS)).toBe(false);
      expect(channelEnabled(pref, CommsChannel.EMAIL)).toBe(true);
    });
  });

  describe('decideChannel', () => {
    it('opt-out wins → suppress (even for an urgent event)', () => {
      const pref = { ...quietPref, pushEnabled: false };
      const d = decideChannel(pref, CommsChannel.PUSH, true, DAY, 'defer', TZ);
      expect(d.action).toBe('suppress');
    });

    it('urgent event bypasses quiet hours → send', () => {
      const d = decideChannel(quietPref, CommsChannel.SMS, true, NIGHT, 'defer', TZ);
      expect(d).toEqual({ action: 'send', scheduledFor: null });
    });

    it('non-urgent inside quiet hours, policy=defer → defer to window end', () => {
      const d = decideChannel(quietPref, CommsChannel.SMS, false, NIGHT, 'defer', TZ);
      expect(d.action).toBe('defer');
      if (d.action === 'defer') {
        // deferred to local 07:00 (= +8.5h from 22:30)
        expect(d.scheduledFor.getTime()).toBe(NIGHT.getTime() + 510 * 60_000);
      }
    });

    it('non-urgent inside quiet hours, policy=suppress → suppress', () => {
      const d = decideChannel(quietPref, CommsChannel.SMS, false, NIGHT, 'suppress', TZ);
      expect(d.action).toBe('suppress');
    });

    it('non-urgent outside quiet hours → send', () => {
      const d = decideChannel(quietPref, CommsChannel.SMS, false, DAY, 'defer', TZ);
      expect(d).toEqual({ action: 'send', scheduledFor: null });
    });

    it('absent pref → send (no quiet hours), even non-urgent at night', () => {
      const d = decideChannel(null, CommsChannel.SMS, false, NIGHT, 'defer', TZ);
      expect(d).toEqual({ action: 'send', scheduledFor: null });
    });
  });
});
