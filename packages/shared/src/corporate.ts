/**
 * Corporate accounts + per-account rate cards + building-match pricing (Increment 15 — PRD §9.2 pricing,
 * §3.3/§17.3 RBAC). Members order and PAY INDIVIDUALLY (billingMode PER_ORDER) but are priced on a
 * corporate account's rate card via one of two engines:
 *   • Building match (the condo path) — the booking's service point falls inside a corporate building's
 *     boundary (`Site.geo` + `Site.matchRadiusM`, real PostGIS ST_DWithin) → priced on that account.
 *   • Join code (the TTC path) — the member redeems a per-account code → a CorporateMembership (pricing
 *     only; never widens order scope) → priced on that account.
 * Both feed `Order.pricingAccountId` (the EFFECTIVE PRICING ACCOUNT); `Order.accountId` stays the payer,
 * so the §5.1 spine, payment, and RBAC are untouched. Wire shapes only — the engine lives in
 * `apps/api/src/corporate` + `apps/api/src/orders` and reuses `PricingService.resolveRate`.
 */
import { z } from 'zod';
import { geoPointSchema } from './validators';
import { AccountType, BillingMode, ServiceUnit } from './enums';

// ───────────────────────────── corporate account CRUD ─────────────────────────────

/** Create a corporate account — a BUSINESS account whose members pay individually (PER_ORDER). */
export const createCorporateAccountSchema = z.object({
  name: z.string().trim().min(1).max(160),
});
export type CreateCorporateAccountDto = z.infer<typeof createCorporateAccountSchema>;

export const updateCorporateAccountSchema = z
  .object({ name: z.string().trim().min(1).max(160).optional() })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateCorporateAccountDto = z.infer<typeof updateCorporateAccountSchema>;

// ───────────────────────────── buildings (Site + match boundary) ─────────────────────────────

/**
 * A corporate building = a `Site` with a geo point + a match radius (metres). v1 boundary: address point
 * + radius (the simplest reliable, deterministic rule; postal/explicit-address match is a later option).
 * `matchRadiusM` is bounded [10, 5000] — a sane tower-to-block range, never a city-wide net.
 */
export const createBuildingSchema = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().max(300).optional(),
  geo: geoPointSchema,
  matchRadiusM: z.number().int().min(10).max(5000),
});
export type CreateBuildingDto = z.infer<typeof createBuildingSchema>;

export const updateBuildingSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    geo: geoPointSchema.optional(),
    matchRadiusM: z.number().int().min(10).max(5000).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });
export type UpdateBuildingDto = z.infer<typeof updateBuildingSchema>;

// ───────────────────────────── rate card (PriceList / PriceListItem) ─────────────────────────────

/**
 * Set (upsert) the account's rate for one catalog service — a per-pound (LB) wash&fold rate or a
 * per-item (ITEM) dry-clean price. Writes the account-bound PriceListItem.rate (creating the account's
 * PriceList lazily). Rate is a positive amount with up to 4 dp (the Decimal(12,4) form).
 */
export const setRateCardItemSchema = z.object({
  rate: z.number().positive().max(100000),
});
export type SetRateCardItemDto = z.infer<typeof setRateCardItemSchema>;

// ───────────────────────────── join code ─────────────────────────────

/** Generate/regenerate the account's join code. Optional expiry (days from now; omitted ⇒ never expires). */
export const generateJoinCodeSchema = z
  .object({ expiresInDays: z.number().int().min(1).max(3650).optional() })
  .default({});
export type GenerateJoinCodeDto = z.infer<typeof generateJoinCodeSchema>;

/** Redeem a join code (the authenticated caller becomes a pricing member). Case-insensitive, trimmed. */
export const redeemJoinCodeSchema = z.object({
  code: z.string().trim().min(4).max(40),
});
export type RedeemJoinCodeDto = z.infer<typeof redeemJoinCodeSchema>;

// ───────────────────────────── view shapes ─────────────────────────────

export interface CorporateAccountView {
  id: string;
  name: string;
  type: AccountType;
  billingMode: BillingMode;
  corporate: boolean;
  joinCode: string | null;
  joinCodeExpiresAt: string | null;
  buildingCount: number;
  memberCount: number;
  createdAt: string;
}

export interface CorporateAccountsResult {
  accounts: CorporateAccountView[];
}

export interface CorporateBuildingView {
  id: string;
  accountId: string;
  name: string;
  address: string | null;
  geo: { lat: number; lng: number } | null;
  matchRadiusM: number | null;
  createdAt: string;
}

export interface CorporateBuildingsResult {
  buildings: CorporateBuildingView[];
}

/** Where a resolved rate comes from (mirrors PricingService.RateSource). */
export type RateCardSource = 'account_override' | 'account_list' | 'default_list' | 'service_base';

/**
 * One catalog service on an account's rate card. `accountRate` is the account-specific rate (NULL ⇒ no
 * override; the account falls back to the org default / base). `effectiveRate`/`source` are exactly what
 * `PricingService.resolveRate` would resolve for this account — the resolved rate, shown clearly.
 */
export interface RateCardItemView {
  serviceId: string;
  serviceName: string;
  unit: ServiceUnit;
  accountRate: string | null;
  defaultRate: string | null;
  baseRate: string;
  effectiveRate: string;
  source: RateCardSource;
}

export interface RateCardView {
  accountId: string;
  priceListId: string | null;
  currency: string;
  items: RateCardItemView[];
}

export interface JoinCodeView {
  accountId: string;
  joinCode: string;
  joinCodeExpiresAt: string | null;
}

/** Result of redeeming a join code — idempotent: `alreadyMember` is true on a repeat redeem. */
export interface RedeemResultView {
  accountId: string;
  accountName: string;
  status: 'ACTIVE';
  source: 'JOIN_CODE';
  alreadyMember: boolean;
}

export interface MembershipView {
  id: string;
  accountId: string;
  accountName: string;
  status: 'ACTIVE' | 'REVOKED';
  source: 'JOIN_CODE' | 'BUILDING';
  createdAt: string;
}

export interface MembershipsResult {
  memberships: MembershipView[];
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const CORPORATE_ERRORS = {
  ACCOUNT_NOT_FOUND: 'corporate.account_not_found',
  NOT_CORPORATE: 'corporate.not_corporate',
  BUILDING_NOT_FOUND: 'corporate.building_not_found',
  SERVICE_NOT_FOUND: 'corporate.service_not_found',
  INVALID_JOIN_CODE: 'corporate.invalid_join_code',
  JOIN_CODE_EXPIRED: 'corporate.join_code_expired',
  NO_JOIN_CODE: 'corporate.no_join_code',
} as const;
export type CorporateErrorCode = (typeof CORPORATE_ERRORS)[keyof typeof CORPORATE_ERRORS];
