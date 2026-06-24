/**
 * Auth contract (Increment 2) — Zod request/response schemas + the derived types
 * and the JWT access-token claim shape. Single source of truth shared by the API
 * (validation + signing) and, later, the client apps.
 */
import { z } from 'zod';
import { RoleScope, RoleType } from './enums';

/** E.164-ish phone. Permissive on length; the transport validates deliverability. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, 'phone must be E.164, e.g. +14165551234');

// ───────────────────────────── requests ─────────────────────────────
export const otpRequestSchema = z.object({ phone: phoneSchema });
export type OtpRequestDto = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
});
export type OtpVerifyDto = z.infer<typeof otpVerifySchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export type RefreshDto = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({ refreshToken: z.string().min(20).optional() });
export type LogoutDto = z.infer<typeof logoutSchema>;

// ───────────────────────────── responses ─────────────────────────────
export const otpRequestResultSchema = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  resendInSeconds: z.number().int().nonnegative(),
  // dev only — the console transport echoes the code so flows are testable without a phone
  devCode: z.string().optional(),
});
export type OtpRequestResult = z.infer<typeof otpRequestResultSchema>;

/** A role grant: the role + the scope it applies at (and which account/site). */
export const roleGrantSchema = z.object({
  role: z.nativeEnum(RoleType),
  scope: z.nativeEnum(RoleScope),
  scopeId: z.string().uuid().nullable(),
});
export type RoleGrant = z.infer<typeof roleGrantSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(), // access-token lifetime in seconds
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const principalSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  roles: z.array(roleGrantSchema),
  // Account/site ids this principal is confined to (empty ⇒ org-wide for org-level roles).
  accountIds: z.array(z.string().uuid()),
  siteIds: z.array(z.string().uuid()),
});
export type Principal = z.infer<typeof principalSchema>;

export const meResponseSchema = z.object({
  user: principalSchema,
  org: z.object({ id: z.string().uuid(), name: z.string() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * JWT access-token claims (PRD §8.1 — JWT carries org + roles + scope).
 * `sub` = userId. `scope` carries the account/site confinement used for row-scoping.
 */
export const accessClaimsSchema = z.object({
  sub: z.string().uuid(),
  org_id: z.string().uuid(),
  typ: z.literal('access'),
  roles: z.array(roleGrantSchema),
  scope: z.object({
    accountIds: z.array(z.string().uuid()),
    siteIds: z.array(z.string().uuid()),
  }),
  jti: z.string(),
  // Standard JWT timestamps (added by the signer); kept so the guard can read exp.
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

/** Distinct token-failure reasons surfaced to clients (problem+json `title`). */
export const AUTH_ERRORS = {
  OTP_RATE_LIMITED: 'otp_rate_limited',
  OTP_INVALID: 'otp_invalid',
  OTP_EXPIRED: 'otp_expired',
  OTP_LOCKED: 'otp_locked',
  TOKEN_INVALID: 'token_invalid',
  TOKEN_EXPIRED: 'token_expired',
  REFRESH_REUSE_DETECTED: 'refresh_reuse_detected',
  FORBIDDEN_ROLE: 'forbidden_role',
} as const;
export type AuthErrorCode = (typeof AUTH_ERRORS)[keyof typeof AUTH_ERRORS];
