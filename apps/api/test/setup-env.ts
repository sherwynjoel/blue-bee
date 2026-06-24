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
