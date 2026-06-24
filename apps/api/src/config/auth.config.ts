/** Typed auth configuration, read once from the environment (PRD §8.1, §12.1). */

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');

export interface AuthConfig {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string; // e.g. "15m" (passed to @nestjs/jwt)
    accessTtlSeconds: number; // numeric form for the response `expiresIn`
    refreshTtlSeconds: number;
  };
  otp: {
    pepper: string;
    ttlSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    ratePerPhone: number;
    ratePerIp: number;
    rateWindowSeconds: number;
  };
  sms: {
    transport: 'console' | 'twilio';
    twilio: { accountSid?: string; authToken?: string; from?: string };
  };
}

/** Parse a short duration like "15m", "30d", "900s", or a bare number of seconds. */
export function parseDurationSeconds(input: string, fallback: number): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'd':
      return n * 86400;
    case 'h':
      return n * 3600;
    case 'm':
      return n * 60;
    case 's':
    case undefined:
      return n;
    default:
      return fallback;
  }
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
}

/**
 * A secret/pepper that must be strong. >= 32 chars of entropy is required everywhere;
 * in production we additionally reject obvious placeholders so a dev secret can never
 * ship. (Dev/test secrets are long but contain "change-me"/"dev-", allowed off-prod.)
 */
function secret(name: string): string {
  const v = req(name);
  if (v.length < 32) {
    throw new Error(`${name} must be at least 32 characters (got ${v.length})`);
  }
  if (process.env.NODE_ENV === 'production' && (/change-me/i.test(v) || /^dev-/i.test(v))) {
    throw new Error(`${name} looks like a placeholder; set a real secret in production`);
  }
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadAuthConfig(): AuthConfig {
  const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
  const refreshTtl = process.env.JWT_REFRESH_TTL ?? '30d';
  const transport = (process.env.SMS_TRANSPORT ?? 'console').toLowerCase() === 'twilio' ? 'twilio' : 'console';
  return {
    jwt: {
      accessSecret: secret('JWT_ACCESS_SECRET'),
      refreshSecret: secret('JWT_REFRESH_SECRET'),
      accessTtl,
      accessTtlSeconds: parseDurationSeconds(accessTtl, 900),
      refreshTtlSeconds: parseDurationSeconds(refreshTtl, 2592000),
    },
    otp: {
      pepper: secret('OTP_PEPPER'),
      ttlSeconds: int('OTP_TTL_SECONDS', 300),
      maxAttempts: int('OTP_MAX_ATTEMPTS', 5),
      resendCooldownSeconds: int('OTP_RESEND_COOLDOWN_SECONDS', 30),
      ratePerPhone: int('OTP_RATE_PER_PHONE', 5),
      ratePerIp: int('OTP_RATE_PER_IP', 20),
      rateWindowSeconds: int('OTP_RATE_WINDOW_SECONDS', 3600),
    },
    sms: {
      transport,
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_FROM_NUMBER,
      },
    },
  };
}
