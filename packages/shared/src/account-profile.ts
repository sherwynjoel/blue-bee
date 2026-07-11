/**
 * Account self-service profile contract (Increment 33) — the editable customer profile: `name` and
 * `email`. Single source of truth for the API (the wire shape it accepts + returns), the customer app
 * (`updateProfile` + the view it renders), and the console (which reads the SAME `User.name`/`User.email`
 * through the Inc-27 customer-360, so an edit here reflects there with no extra plumbing).
 *
 * Scope is deliberately narrow, and the boundaries are honest:
 *   • `phone` is NOT editable here — it is the login identity (OTP), and changing it is an auth concern
 *     (Inc-35), not a profile edit. It is returned read-only so the screen can show "your login".
 *   • `email` is unique per org (`@@unique([orgId, email])`). A collision is a 409, never a silent
 *     overwrite. `null`/empty clears it; a present value is trimmed + lowercased server-side.
 *   • The endpoint is SELF-ONLY: it always acts on the authenticated principal, never a client-supplied
 *     id (the optional `userId` is a self-assertion that must equal the caller — else 403), mirroring
 *     the account-deletion endpoint.
 *
 * The request VALIDATOR (Zod) lives with the endpoint in `apps/api/.../account.dto.ts`; this file owns
 * only the cross-surface TYPES so the app, api and console never redefine them.
 */

/** The customer's editable profile, as returned by `PATCH /v1/account/profile`. `phone` is read-only. */
export interface AccountProfileView {
  id: string;
  name: string;
  /** Unique per org; `null` when the customer has no email. */
  email: string | null;
  /** The login identity (OTP) — read-only here (changing it is an auth concern, Inc-35). */
  phone: string | null;
}

/**
 * The wire body the customer app sends to `PATCH /v1/account/profile`. Every field is optional (PATCH
 * semantics — only present fields change):
 *   • `name`  — a non-empty display name.
 *   • `email` — a value to set; `null` (or an empty string) clears it. Normalized server-side.
 *   • `userId` — an OPTIONAL self-assertion: when present it MUST equal the caller's own id (else 403).
 *     The server never trusts it to pick a target — the target is always the token subject.
 */
export interface UpdateProfileInput {
  name?: string;
  email?: string | null;
  userId?: string;
}

/** Distinct profile-update failure codes surfaced to clients (problem+json `error`). */
export const ACCOUNT_ERRORS = {
  /** The chosen email is already used by another user in the org (`@@unique([orgId, email])`). */
  EMAIL_TAKEN: 'email_taken',
  /** A body targeting another user's id — the endpoint is self-only. */
  FORBIDDEN_SELF_ONLY: 'forbidden_self_only',
  /** The principal's own user row is not in the caller's org (defense-in-depth). */
  ACCOUNT_NOT_FOUND: 'account_not_found',
} as const;
export type AccountErrorCode = (typeof ACCOUNT_ERRORS)[keyof typeof ACCOUNT_ERRORS];
