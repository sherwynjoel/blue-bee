/**
 * Saved-addresses contract (Increment 26) — the customer-owned WRITE side of `Site`. The read side
 * (GET /v1/sites → `CustomerSite`) already exists in `./catalog`; this file adds create / edit /
 * deactivate so a brand-new customer can add their first address instead of being stuck with an
 * empty picker.
 *
 * Two invariants encoded here:
 *
 *  1. **The server geocodes.** A create/update carries a typed `address`; the API resolves it to a
 *     WGS84 point server-side and writes PostGIS `Site.geo`. A caller MAY supply a map-picked `geo`
 *     to skip the lookup, but a coordinate is NEVER fabricated: an address that will not resolve is
 *     rejected (`SITE_ERRORS.GEOCODE_FAILED`) and no row is written.
 *
 *  2. **Serviceability is a three-state answer, not a boolean.** The org may have drawn no active
 *     service zones at all, in which case the geo-gate is inert and the API must NOT claim "we serve
 *     your area". `SiteServiceability.checked` distinguishes "we tested the point" from "there was
 *     nothing to test against" — the app only shows a coverage claim when `checked && serviceable`.
 *     (Honesty firewall, CLAUDE.md.)
 *
 * `Site.name` doubles as the customer-facing LABEL ("Home" / "Work" / free text) — the column already
 * exists, is required, and is what `BookScreen` renders, so no parallel `label` field is introduced.
 */
import { z } from 'zod';
import { geoPointSchema } from './validators';
import type { CustomerSite } from './catalog';

// ───────────────────────────── write DTOs ─────────────────────────────

/**
 * POST /v1/sites. `geo` is OPTIONAL: supply it to accept a map-picked pin verbatim, omit it to have
 * the server geocode `address`. `accountId` is only required when the caller's principal spans more
 * than one account (otherwise it is inferred from the single account in scope).
 */
export const createSiteSchema = z.object({
  /** The customer-facing label — "Home", "Work", or free text. Persisted to `Site.name`. */
  name: z.string().trim().min(1).max(160),
  /** The street address to geocode (and to display in the picker). */
  address: z.string().trim().min(1).max(300),
  /** Apartment / suite / unit number. */
  unit: z.string().trim().max(40).optional(),
  /** Buzzer or entry code. */
  buzzer: z.string().trim().max(40).optional(),
  /** Free-form access notes for the driver ("side door", "leave with concierge"). */
  notes: z.string().trim().max(500).optional(),
  /** Make this the account's default pickup/delivery address (demotes the previous default). */
  isDefault: z.boolean().optional(),
  /** Required only when the principal is scoped to >1 account; must be one of them. */
  accountId: z.string().uuid().optional(),
  /** A map-picked pin. When present the server trusts it and skips geocoding. */
  geo: geoPointSchema.optional(),
});
export type CreateSiteDto = z.infer<typeof createSiteSchema>;

/** PATCH /v1/sites/:id — every field optional; at least one must be present. */
export const updateSiteSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().min(1).max(300).optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    buzzer: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    isDefault: z.boolean().optional(),
    geo: geoPointSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type UpdateSiteDto = z.infer<typeof updateSiteSchema>;

// ───────────────────────────── serviceability ─────────────────────────────

/**
 * The org's coverage answer for a saved address' point. THREE states, because "not out of area" and
 * "in our service area" are different claims:
 *
 *   • `checked: false`                    → the org has drawn no active service zones; the gate is
 *                                           inert. Claim NOTHING. (`serviceable` is meaningless.)
 *   • `checked: true,  serviceable: true` → the point is inside an active zone (PostGIS ST_Covers).
 *   • `checked: true,  serviceable: false`→ outside every active zone. The server has captured the
 *                                           address as demand; `coverageRequestId` is that row.
 */
export interface SiteServiceability {
  /** Did we actually test the point against ≥1 active zone? */
  checked: boolean;
  /** Only meaningful when `checked` is true. */
  serviceable: boolean;
  /** The captured `CoverageRequest` id when out-of-area; null otherwise. */
  coverageRequestId: string | null;
}

/** POST /v1/sites and PATCH /v1/sites/:id — the saved row plus the coverage answer for its point. */
export interface SiteMutationResult {
  site: CustomerSite;
  serviceability: SiteServiceability;
}

/** POST /v1/sites/:id:deactivate — the soft-deleted row (`active: false`). */
export interface SiteDeactivateResult {
  site: CustomerSite;
  /** The site promoted to default when the deactivated one held it; null if none/unchanged. */
  promotedDefaultSiteId: string | null;
}

// ───────────────────────────── error codes (problem+json `error`) ─────────────────────────────

export const SITE_ERRORS = {
  /** 404 — no such site within the caller's row scope (also the cross-account answer: never leak existence). */
  SITE_NOT_FOUND: 'site.not_found',
  /** 422 — the address could not be resolved to a point. No row is written; no coordinate is invented. */
  GEOCODE_FAILED: 'site.geocode_failed',
  /** 503 — the geocoding provider errored or timed out. Transient; the caller may retry. */
  GEOCODE_UNAVAILABLE: 'site.geocode_unavailable',
  /** 400 — the principal spans >1 account, so `accountId` must be supplied explicitly. */
  ACCOUNT_AMBIGUOUS: 'site.account_ambiguous',
  /** 403 — the principal has no account scope at all (e.g. org-staff with no account confinement). */
  NO_ACCOUNT: 'site.no_account',
  /** 403 — the supplied `accountId` is outside the principal's scope. */
  ACCOUNT_FORBIDDEN: 'site.account_forbidden',
  /** 409 — the site is deactivated; reactivate before editing. */
  SITE_INACTIVE: 'site.inactive',
} as const;
export type SiteErrorCode = (typeof SITE_ERRORS)[keyof typeof SITE_ERRORS];
