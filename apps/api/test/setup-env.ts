/* Loads apps/api/.env into process.env for tests (no dotenv dep). Runs via jest setupFiles. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
// Force the dev SMS transport so OTP codes are echoed (devCode) in tests.
process.env.SMS_TRANSPORT = 'console';
// Tests issue many OTPs from one IP; raise the per-IP cap so it doesn't gate the suite
// (per-phone cooldown is still exercised by the rate-limit test).
process.env.OTP_RATE_PER_IP = '100000';

// ── Notifications (Increment 8) ── real-but-local transports (console email/push; no SENDGRID/EXPO
// creds ⇒ no external calls), deterministic retry: tiny backoff + 2 attempts so the retry e2e
// exhausts/recovers without timers, and NO background drain scan (drained explicitly in specs).
process.env.PUSH_TRANSPORT = 'console';
process.env.NOTIF_MAX_ATTEMPTS = '2';
process.env.NOTIF_RETRY_BACKOFF_MS = '1';
process.env.NOTIF_RETRY_SCAN_MS = '0';
process.env.NOTIF_SEND_TIMEOUT_MS = '4000';
// Disable the background send kick so specs drive the drain explicitly (deterministic, no races).
process.env.NOTIF_KICK_ON_DISPATCH = 'false';
// Test-env ONLY: mark just `geofence.approaching` urgent so a single ping exercises BOTH the
// urgent-bypass (approaching) and the quiet-hours-defer (arrived) paths. Production keeps both
// geofence alerts urgent (the config default).
process.env.NOTIF_URGENT_EVENT_TYPES = 'geofence.approaching';
