/**
 * Referral contract (Increment 34) — invite + code + attribution. **Reward is DEFERRED**: this increment
 * lets a customer share a code and see who joined; it grants and promises NOTHING. Copy that states or
 * implies a reward ("earn/get $X", credits, a balance) is a honesty-firewall violation — do not add it
 * here or in any surface that renders this contract.
 *
 * Single source of truth for the API (code generation + the account endpoints), the customer app (the
 * Refer tab), and the console (customer-360 attribution). Attribution is stored as `User.referredByUserId`
 * and derived from it (no separate table).
 */

/**
 * The referral-code alphabet — Crockford-ish, with the visually ambiguous characters removed (no `0/O`,
 * no `1/I/L`). Uppercase only. **The SQL backfill in `20260711120000_referrals_inc34` hard-codes this
 * same alphabet + length — keep them in sync.** 8 chars over a 31-symbol alphabet ≈ 8.5×10¹¹ codes, so
 * collisions are astronomically unlikely and, if they ever happen, the `@unique` index + a regenerate loop
 * make assignment collision-safe.
 */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

/**
 * Generate one candidate code. Takes an injected `randomInt(maxExclusive)` (so the caller supplies the
 * entropy source — `crypto.randomInt` on the server) rather than reaching for a banned global. Uniqueness
 * is the CALLER's job (check the DB + retry); this only shapes a candidate.
 */
export function generateReferralCode(randomInt: (maxExclusive: number) => number): string {
  let out = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    out += REFERRAL_CODE_ALPHABET.charAt(randomInt(REFERRAL_CODE_ALPHABET.length));
  }
  return out;
}

/** Normalize a user-entered code to the canonical form: trim, uppercase, strip spaces/hyphens. */
export function normalizeReferralCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]+/g, '');
}

/** Cheap shape check (right length + only alphabet chars) — NOT a validity check (that's a DB lookup). */
export function isReferralCodeShape(code: string): boolean {
  if (code.length !== REFERRAL_CODE_LENGTH) return false;
  for (const ch of code) {
    if (!REFERRAL_CODE_ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * `GET /v1/account/referral` — the signed-in customer's OWN invite code. `shareUrl` is a deep link ONLY
 * when a share-base is actually configured server-side; otherwise it is `null` and the app shares the bare
 * code (never a fabricated domain).
 */
export interface ReferralView {
  code: string;
  shareUrl: string | null;
}

/** One person who joined via my code — name-minimal, no PII beyond a display name. */
export interface ReferredJoinerView {
  userId: string;
  name: string;
  joinedAt: string;
}

/** `GET /v1/account/referrals` — who joined via my code (row-scoped to me), newest first, + a total count. */
export interface ReferralsView {
  count: number;
  joiners: ReferredJoinerView[];
}
