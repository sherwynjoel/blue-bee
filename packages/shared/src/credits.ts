/**
 * Customer credit contract (Increment 37) — the referral REWARD that Inc-34 deliberately deferred, now REAL.
 *
 * This is money-equivalent, so the shapes encode the guarantees:
 *   • The ledger is APPEND-ONLY and signed. `balance` is always `SUM(amount)` server-side — never a stored
 *     counter the client (or a bug) can drift.
 *   • The **earn rule is stated, not implied**: a referrer is credited when their referred friend's FIRST
 *     order reaches DELIVERED. Granting at signup would be farmable with throwaway accounts.
 *   • The reward amount is FOUNDER-SET (`Organization.settings`). **Unset/0 ⇒ no reward exists**, and the
 *     app must render NO reward claim at all (`ReferralRewardTerms.enabled === false`). That is what keeps
 *     the Inc-34 honesty firewall intact until the founder actually funds a reward.
 *   • Redemption is applied server-side at payment time and is idempotent per order (DB unique index) — a
 *     retried PaymentIntent can never spend the same credit twice.
 */
import { z } from 'zod';

/** Why a credit entry exists. Mirrors the Prisma `CreditEntryKind`. */
export const CREDIT_ENTRY_KINDS = ['REFERRAL_EARN', 'REDEMPTION', 'ADJUSTMENT', 'REVERSAL'] as const;
export type CreditEntryKind = (typeof CREDIT_ENTRY_KINDS)[number];

/** One immutable line in the customer's ledger. `amount` is signed: + granted, − spent. Decimal STRING. */
export interface CreditEntryView {
  id: string;
  kind: CreditEntryKind;
  /** Signed decimal string, e.g. "10.00" (granted) or "-10.00" (spent). */
  amount: string;
  currency: string;
  /** Set on REDEMPTION / REVERSAL — the order the credit was spent against / returned from. */
  orderId: string | null;
  /** Set on REFERRAL_EARN — the friend whose first delivery earned it (display name only). */
  referredName: string | null;
  note: string | null;
  createdAt: string;
}

/** `GET /v1/account/credits` — the customer's REAL balance + their ledger. Self-scoped server-side. */
export interface CreditBalanceView {
  /** `SUM(amount)` over the ledger, as a decimal string. Never negative (redemption is capped at balance). */
  balance: string;
  currency: string;
  entries: CreditEntryView[];
}

/**
 * The live referral-reward terms, resolved from the founder's config. The app renders its reward copy FROM
 * THIS — never from hard-coded strings and never from founder free-text — so the promise can never outrun
 * the ledger.
 */
export interface ReferralRewardTerms {
  /** FALSE when the founder has not funded a reward (amount unset/0). The app must then promise NOTHING. */
  enabled: boolean;
  /** The amount a referrer earns, as a decimal string. `null` when `enabled` is false. */
  amount: string | null;
  currency: string;
  /**
   * The exact, honest condition the credit is granted on — so the UI never has to invent the terms.
   * Today there is one rule; it is named rather than assumed.
   */
  earnedWhen: 'referred_friend_first_order_delivered';
}

// ───────────────────────────── console (OWNER/FINANCE) ─────────────────────────────

/** Manual credit grant/deduction from the console. Signed; a note is REQUIRED (this is money). */
export const adjustCreditSchema = z.object({
  /** Signed decimal amount, e.g. 10 (grant) or -10 (deduct). Non-zero. */
  amount: z.number().refine((n) => n !== 0, 'amount must be non-zero').refine((n) => Math.abs(n) <= 100_000, 'amount is too large'),
  /** Why — mandatory, stored on the immutable entry and audited. */
  note: z.string().trim().min(1, 'a note is required for a manual credit adjustment').max(500),
});
export type AdjustCreditDto = z.infer<typeof adjustCreditSchema>;

/** The founder's referral-reward setting (console). `amount: 0` (or null) turns the reward OFF entirely. */
export const setReferralRewardSchema = z.object({
  amount: z.number().min(0).max(10_000).nullable(),
});
export type SetReferralRewardDto = z.infer<typeof setReferralRewardSchema>;

/** Credit summary for the console customer-360. */
export interface CustomerCreditView {
  balance: string;
  currency: string;
  entries: CreditEntryView[];
}

export const CREDIT_ERRORS = {
  /** A manual deduction that would push the balance below zero. */
  INSUFFICIENT_BALANCE: 'credit.insufficient_balance',
} as const;
export type CreditErrorCode = (typeof CREDIT_ERRORS)[keyof typeof CREDIT_ERRORS];
