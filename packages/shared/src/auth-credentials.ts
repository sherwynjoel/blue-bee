/**
 * Login-expansion contract (Increment 35) — email+password and OAuth (Apple + Google) ALONGSIDE the
 * existing phone-OTP path. Single source of truth for the API (validation) and the customer app.
 *
 * Security invariants baked into the shapes:
 *   • Passwords are min-length gated here and hashed (bcrypt) at rest server-side — never sent/stored raw.
 *   • Email is trimmed + lower-cased so it matches the `@@unique([orgId, email])` used to dedupe the three
 *     methods to ONE account.
 *   • OAuth passes a provider ID TOKEN (verified server-side against the provider JWKS) — never trusted
 *     client claims (no client-sent email/sub is believed).
 *   • `referralCode` (register/oauth) is optional and NEVER fails the signup — see ReferralService.
 */
import { z } from 'zod';

/** The four sign-in methods a customer account can have linked (stored in `User.authProviders`). */
export const AUTH_PROVIDERS = ['otp', 'password', 'google', 'apple'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/** OAuth providers we verify server-side. */
export const OAUTH_PROVIDERS = ['google', 'apple'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Password policy — a floor, not theatre. 8–200 chars (bcrypt truncates at 72 bytes, so we also cap). */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
export const passwordSchema = z.string().min(PASSWORD_MIN, `password must be at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX);

/** Normalized email — trimmed + lower-cased, so lookups/dedupe are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().email('a valid email is required').max(254);

/** Optional inbound referral code (register/oauth). Never validated hard here — ReferralService decides. */
const optionalReferralCode = z.string().trim().max(64).optional();

// ───────────────────────────── requests ─────────────────────────────

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'name is required').max(120),
  referralCode: optionalReferralCode,
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const emailLoginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX) });
export type EmailLoginDto = z.infer<typeof emailLoginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;

export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequestDto = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetConfirmSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export type PasswordResetConfirmDto = z.infer<typeof passwordResetConfirmSchema>;

export const oauthSignInSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  /** The provider-issued ID token (JWT) — verified server-side; client claims are never trusted. */
  idToken: z.string().min(20),
  referralCode: optionalReferralCode,
});
export type OAuthSignInDto = z.infer<typeof oauthSignInSchema>;

/** Authenticated: set or change the password (links the 'password' method). `currentPassword` required
 *  only when one is already set (verified server-side). */
export const setPasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX).optional(),
  newPassword: passwordSchema,
});
export type SetPasswordDto = z.infer<typeof setPasswordSchema>;

// ───────────────────────────── responses ─────────────────────────────

/** `POST /register`, `/oauth`: the SAME session as OTP (a TokenPair) + whether the email needs verifying. */
export interface AuthResultView {
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
  };
  /** True once the account's email is proven controlled (verify-email token, or an OAuth provider). */
  emailVerified: boolean;
  /** Which method this sign-in resolved through, and whether a new account was minted. */
  provider: AuthProvider;
  created: boolean;
}

/** `POST /register`, `/password/reset` also echo a dev-only token when the email transport is `console`,
 *  so flows are testable without a mailbox (mirrors OTP `devCode`; never emitted in production). */
export interface DevTokenEcho {
  devToken?: string;
}

/** `GET /v1/auth/methods` — the Profile "Login & security" view: which methods are linked + verify state. */
export interface AccountSecurityView {
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  hasPassword: boolean;
  /** The linked sign-in methods (from `User.authProviders`), e.g. ['otp','password','google']. */
  methods: AuthProvider[];
}

// ───────────────────────────── error codes (problem+json `title`) ─────────────────────────────

export const AUTH_CRED_ERRORS = {
  EMAIL_TAKEN: 'email_taken',
  INVALID_CREDENTIALS: 'invalid_credentials',
  ACCOUNT_LOCKED: 'account_locked',
  TOKEN_INVALID: 'auth_token_invalid',
  TOKEN_EXPIRED: 'auth_token_expired',
  PROVIDER_TOKEN_INVALID: 'provider_token_invalid',
  PROVIDER_EMAIL_UNVERIFIED: 'provider_email_unverified',
  WRONG_PASSWORD: 'wrong_password',
  PASSWORD_NOT_SET: 'password_not_set',
  LAST_METHOD: 'last_method', // can't unlink your only remaining way in
  CANNOT_UNLINK_OTP: 'cannot_unlink_otp',
} as const;
export type AuthCredErrorCode = (typeof AUTH_CRED_ERRORS)[keyof typeof AUTH_CRED_ERRORS];
