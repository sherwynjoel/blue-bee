/**
 * Preference + quiet-hours decision (Increment 8, §8.5) — PURE so the defer-vs-suppress-vs-send
 * logic is unit-tested deterministically against a fixed `now`. The preferences SERVICE loads the
 * row from the DB and delegates the decision here.
 */
import { CommsChannel } from '@blue-bee/shared';
import { isWithinQuietHours, quietHoursEndAt } from './quiet-hours';
import type { QuietHoursPolicy } from '../config/notifications.config';

/** A user's loaded notification preferences (absent row ⇒ pass `null` ⇒ all-on, no quiet hours). */
export interface UserNotificationPref {
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
}

/** The outcome for one (channel, event) pair. */
export type ChannelDecision =
  | { action: 'send'; scheduledFor: null } // deliver now
  | { action: 'defer'; scheduledFor: Date } // hold until quiet hours end (still PENDING)
  | { action: 'suppress'; reason: string }; // never send (opt-out or quiet-hours suppress policy)

/** Is `channel` enabled for this user? Absent pref ⇒ true (default-on). */
export function channelEnabled(pref: UserNotificationPref | null, channel: CommsChannel): boolean {
  if (!pref) return true;
  switch (channel) {
    case CommsChannel.PUSH:
      return pref.pushEnabled;
    case CommsChannel.SMS:
      return pref.smsEnabled;
    case CommsChannel.EMAIL:
      return pref.emailEnabled;
    default:
      return true;
  }
}

/**
 * Decide what to do with a (channel, urgent) at `now`, given the user's pref + the quiet-hours
 * policy. Order: opt-out wins (suppress) → urgent bypasses quiet hours (send) → inside quiet hours
 * defer/suppress per policy → otherwise send.
 */
export function decideChannel(
  pref: UserNotificationPref | null,
  channel: CommsChannel,
  urgent: boolean,
  now: Date,
  policy: QuietHoursPolicy,
  defaultTimezone: string,
): ChannelDecision {
  if (!channelEnabled(pref, channel)) return { action: 'suppress', reason: 'channel opted out' };
  if (urgent || !pref) return { action: 'send', scheduledFor: null }; // urgent alerts are time-critical
  const tz = pref.timezone || defaultTimezone;
  if (isWithinQuietHours(now, tz, pref.quietHoursStart, pref.quietHoursEnd)) {
    if (policy === 'suppress') return { action: 'suppress', reason: 'quiet hours (suppress policy)' };
    return { action: 'defer', scheduledFor: quietHoursEndAt(now, tz, pref.quietHoursEnd as number) };
  }
  return { action: 'send', scheduledFor: null };
}
