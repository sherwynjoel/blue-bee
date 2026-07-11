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
    /**
     * Fixed codes that log a seeded phone in WITHOUT an SMS round-trip — a staging/demo testing
     * convenience so QA doesn't have to fish the code out of the logs. Opt-in via OTP_DEV_BYPASS_CODE
     * (CSV, e.g. "000000,0000"); empty = disabled. HARD-disabled when NODE_ENV=production, so a demo
     * shortcut can never weaken real auth even if the env var is left set.
     */
    devBypassCodes: string[];
  };
  /**
   * Short-lived signed capability token for the customer WS tracking channel (Increment 6,
   * PRD §6.2). DEDICATED secret — never the auth JWT secret — so a tracking token can never
   * be confused with or escalate to a session token. The token binds exactly one vehicle for
   * one order's active stop; its real authorization is re-checked against live stop state at
   * the WS handshake, so the TTL is only a coarse upper bound.
   */
  channelToken: {
    secret: string;
    ttlSeconds: number;
  };
  sms: {
    transport: 'console' | 'twilio';
    twilio: { accountSid?: string; authToken?: string; from?: string };
  };
  // [Inc-35] Email+password credential + rate-limit/lockout + email-delivered token TTLs.
  credential: {
    bcryptRounds: number;
    loginMaxAttempts: number; // wrong-password attempts per window before lockout
    loginWindowSeconds: number;
    lockoutSeconds: number;
    verifyTokenTtlSeconds: number;
    resetTokenTtlSeconds: number;
  };
  // [Inc-35] OAuth (Apple + Google). `clientIds` are the accepted `aud` values (founder-supplied, CSV);
  // empty ⇒ the real verifier rejects every token for that provider (fail-closed until configured).
  oauth: {
    google: { clientIds: string[] };
    apple: { clientIds: string[] };
  };
  // [Inc-35] Transactional email (verify + reset). Console (dev, logs + echoes) or SendGrid (prod).
  email: {
    transport: 'console' | 'sendgrid';
    from: string;
    sendgridApiKey?: string;
  };
  // [Inc-35] The org a NEW self-service signup (email/OAuth) lands in. Single-tenant MVP ⇒ the demo org;
  // prod sets DEFAULT_SIGNUP_ORG_ID. OTP is unaffected (it resolves the existing user's org).
  signupOrgId: string;
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

/**
 * Fixed OTP bypass codes for staging/demo login (e.g. "000000,0000"). Opt-in only — empty unless
 * OTP_DEV_BYPASS_CODE is set — and force-empty in production regardless of the env var so the demo
 * shortcut can never ship to prod.
 */
function loadDevBypassCodes(): string[] {
  if (process.env.NODE_ENV === 'production') return [];
  const raw = process.env.OTP_DEV_BYPASS_CODE;
  if (!raw) return [];
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
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
      devBypassCodes: loadDevBypassCodes(),
    },
    channelToken: {
      secret: secret('CHANNEL_TOKEN_SECRET'),
      ttlSeconds: int('CHANNEL_TOKEN_TTL_SECONDS', 600),
    },
    sms: {
      transport,
      twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        from: process.env.TWILIO_FROM_NUMBER,
      },
    },
    credential: {
      bcryptRounds: int('BCRYPT_ROUNDS', 12),
      loginMaxAttempts: int('LOGIN_MAX_ATTEMPTS', 10),
      loginWindowSeconds: int('LOGIN_WINDOW_SECONDS', 900),
      lockoutSeconds: int('LOGIN_LOCKOUT_SECONDS', 900),
      verifyTokenTtlSeconds: int('EMAIL_VERIFY_TTL_SECONDS', 86400),
      resetTokenTtlSeconds: int('PASSWORD_RESET_TTL_SECONDS', 3600),
    },
    oauth: {
      google: { clientIds: csv(process.env.OAUTH_GOOGLE_CLIENT_IDS) },
      apple: { clientIds: csv(process.env.OAUTH_APPLE_CLIENT_IDS) },
    },
    email: {
      transport: (process.env.EMAIL_TRANSPORT ?? 'console').toLowerCase() === 'sendgrid' ? 'sendgrid' : 'console',
      from: process.env.EMAIL_FROM ?? 'no-reply@bluebee.example',
      sendgridApiKey: process.env.SENDGRID_API_KEY,
    },
    signupOrgId: process.env.DEFAULT_SIGNUP_ORG_ID ?? '11111111-1111-4111-8111-111111111111',
  };
}

/** Parse a comma-separated env var into a trimmed, non-empty list (empty when unset). */
function csv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
