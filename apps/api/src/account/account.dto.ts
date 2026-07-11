import { z } from 'zod';

/**
 * Body for `DELETE /v1/account` (and the `POST /v1/account:delete` alias).
 *
 * Both fields are OPTIONAL — the app sends `{}` (or nothing). The endpoint ALWAYS acts on the
 * authenticated principal (`@CurrentUser().userId`); it never trusts a client-supplied id to pick a
 * target. `userId`, when present, is a self-targeting ASSERTION: it must equal the caller's own id,
 * otherwise the request is refused with 403 (a user can only delete THEMSELVES). This makes the
 * "can't delete another account" guarantee explicitly testable while keeping the security property
 * (the real target is the token subject, full stop).
 */
export const deleteAccountSchema = z.object({
  /** Optional self-assertion: if set, MUST equal the caller's own user id (else 403). */
  userId: z.string().uuid().optional(),
  /** Optional UI confirmation flag; not load-bearing server-side (the confirm gate lives in the app). */
  confirm: z.boolean().optional(),
});

export type DeleteAccountDto = z.infer<typeof deleteAccountSchema>;

/**
 * Body for `PATCH /v1/account/profile` — the self-service profile edit (Inc-33). Every field is
 * optional (PATCH semantics — only present fields change), and the endpoint ALWAYS acts on the
 * authenticated principal:
 *   • `userId` — an OPTIONAL self-assertion, like the delete endpoint: if present it MUST equal the
 *     caller's own id, otherwise 403 (a user can only edit THEMSELVES). Never used to pick a target.
 *   • `name`  — trimmed; must be non-empty (1–120 chars) when present.
 *   • `email` — trimmed + LOWERCASED; `null` or an empty string clears it, a present value must be a
 *     valid address (≤254 chars). Uniqueness (`@@unique([orgId, email])`) is enforced in the service
 *     (409 `email_taken`), not here — this only shapes/normalizes the value.
 * `phone` is intentionally absent: it is the login identity (OTP), not a profile field (Inc-35).
 */
export const updateProfileSchema = z.object({
  /** Optional self-assertion: if set, MUST equal the caller's own user id (else 403). */
  userId: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name must not be empty').max(120, 'name is too long').optional(),
  email: z
    // Accept a string (to set/clear) or an explicit null (to clear). Absent ⇒ leave email untouched.
    .union([z.string().trim().max(254, 'email is too long'), z.null()])
    .optional()
    // Normalize: undefined stays "absent"; null/'' become an explicit clear; otherwise lowercase.
    .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v.toLowerCase()))
    // Validate the address only for a present, non-clearing value.
    .refine((v) => v === undefined || v === null || z.string().email().safeParse(v).success, {
      message: 'email must be a valid email address',
    }),
});

export type UpdateProfileDto = z.infer<typeof updateProfileSchema>;

/** Counts of rows hard-removed for the user, returned for evidence (no PII). */
export interface AccountDeletionRemoved {
  refreshTokens: number;
  deviceTokens: number;
  devices: number;
  notifications: number;
  notificationPreferences: number;
  roles: number;
}

/** `DELETE /v1/account` response — a non-PII summary of what the irreversible deletion did. */
export interface AccountDeletionResult {
  status: 'deleted';
  userId: string;
  /** The user row was anonymized in place (never re-identifiable from it). */
  anonymized: true;
  /** Driver rows whose `license` (PII) was scrubbed (0 for non-drivers). */
  driversScrubbed: number;
  removed: AccountDeletionRemoved;
}
