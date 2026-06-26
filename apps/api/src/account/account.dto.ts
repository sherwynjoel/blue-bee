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
