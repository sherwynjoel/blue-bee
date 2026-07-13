/**
 * Customer Home contract (Increment 37) — the landing tab: founder-authored "What's new" cards, a snapshot of
 * MY ORDERS, and MY ACCOUNT (including the REAL credit balance).
 *
 * Two rules this contract enforces:
 *   1. **The founder owns the words.** Every announcement card is a `HomeBlock` edited in the console; the app
 *      hard-codes no marketing copy. A console edit reaches the app on the next Home focus/refresh.
 *   2. **The app never invents the reward.** A block's free text is just text — the referral REWARD TERMS come
 *      from `ReferralRewardTerms` (resolved from the founder's funded config) and the balance comes from the
 *      real ledger. If no reward is funded, `reward.enabled` is false and the app shows no reward claim,
 *      whatever a block happens to say.
 */
import { z } from 'zod';
import type { CreditBalanceView, ReferralRewardTerms } from './credits';
import type { OrderStatus } from './enums';

export const HOME_BLOCK_KINDS = ['ANNOUNCEMENT'] as const;
export type HomeBlockKind = (typeof HOME_BLOCK_KINDS)[number];

/**
 * Where a block's CTA sends the customer. A SEMANTIC key the app maps to one of its own tabs — never a raw
 * route or URL, so the console cannot deep-link the app somewhere that does not exist.
 */
export const HOME_CTA_TARGETS = ['refer', 'services', 'orders'] as const;
export type HomeCtaTarget = (typeof HOME_CTA_TARGETS)[number];

/** One founder-authored card on Home. */
export interface HomeBlockView {
  id: string;
  kind: HomeBlockKind;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaTarget: HomeCtaTarget | null;
  sortOrder: number;
}

/** A compact order row for the Home "My orders" section (the full list lives on the Orders tab). */
export interface HomeOrderView {
  id: string;
  status: OrderStatus;
  createdAt: string;
  /** The order's total (or its pre-intake estimate low bound) as a decimal string, or null when unpriced. */
  total: string | null;
  currency: string;
}

/** `GET /v1/home` — everything the Home tab renders, in one round trip. All of it is real, live data. */
export interface HomeView {
  /** Founder-authored announcement cards, active only, in `sortOrder`. Empty ⇒ the app shows no promo area. */
  blocks: HomeBlockView[];
  /** The customer's REAL credit balance + ledger (never a placeholder). */
  credits: CreditBalanceView;
  /** The live referral reward terms. `enabled: false` ⇒ the app promises NOTHING. */
  reward: ReferralRewardTerms;
  /** The most recent orders (newest first), capped — a snapshot, not the full history. */
  recentOrders: HomeOrderView[];
  /** Total orders this customer's account has (may exceed `recentOrders.length`). */
  orderCount: number;
  /** Identity for the "My account" section. */
  account: {
    name: string;
    email: string | null;
    phone: string | null;
    /** Their invite code (Inc-34) — so Home can surface it without another round trip. */
    referralCode: string | null;
  };
}

/** How many recent orders Home embeds before linking out to the Orders tab. */
export const HOME_RECENT_ORDER_LIMIT = 3;

// ───────────────────────────── console CRUD (OWNER) ─────────────────────────────

const ctaTarget = z.enum(HOME_CTA_TARGETS);

export const createHomeBlockSchema = z.object({
  title: z.string().trim().min(1, 'a title is required').max(120),
  body: z.string().trim().min(1, 'body copy is required').max(500),
  ctaLabel: z.string().trim().min(1).max(40).nullable().optional(),
  ctaTarget: ctaTarget.nullable().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type CreateHomeBlockDto = z.infer<typeof createHomeBlockSchema>;

/** Patch — every field optional; at least one must be present. */
export const updateHomeBlockSchema = createHomeBlockSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'provide at least one field to update');
export type UpdateHomeBlockDto = z.infer<typeof updateHomeBlockSchema>;

/** The console's view of a block (includes `active`, which the customer read filters on). */
export interface HomeBlockAdminView extends HomeBlockView {
  active: boolean;
  updatedAt: string;
}
