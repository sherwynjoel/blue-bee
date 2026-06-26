/**
 * Account read contract (Track-A B2B account console) — Zod query schema + view shapes for the two
 * thin, read-only account-directory endpoints the console renders (`GET /v1/accounts`,
 * `GET /v1/accounts/:accountId`). These are pure reads (not audited); the per-account writes
 * (billing terms, batch invoice) + standing-order CRUD live in `recurring.ts`. No schema change.
 */
import { z } from 'zod';
import { AccountType, BillingMode } from './enums';

export const listAccountsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

/** One account row in the directory — summary + cheap relation counts (computed server-side). */
export interface AccountListItemView {
  id: string;
  name: string;
  type: AccountType;
  billingMode: BillingMode;
  billingNetDays: number;
  siteCount: number;
  activeStandingOrderCount: number;
}

export interface AccountListResult {
  accounts: AccountListItemView[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** A site reference on the account detail (drives the standing-order create-form site picker). */
export interface AccountSiteRef {
  id: string;
  name: string;
}

/** Account detail — the list summary + created-at + the account's sites (the SO create-form picker). */
export interface AccountDetailView extends AccountListItemView {
  createdAt: string;
  sites: AccountSiteRef[];
}

export const ACCOUNTS_ERRORS = {
  ACCOUNT_NOT_FOUND: 'accounts.account_not_found',
} as const;
export type AccountsErrorCode = (typeof ACCOUNTS_ERRORS)[keyof typeof ACCOUNTS_ERRORS];

// ───────────────────── account portal — Manifests tab (GET /v1/accounts/:id/manifests) ─────────────────────

/**
 * One account-scoped route-stop manifest (Track-A B2B portal — Manifests tab). A read-only VIEW of an
 * already-generated manifest (generation stays on the route/stop endpoints — this never creates one).
 * Summary fields only: the stop it snapshots + the expected item count (the load-sheet size).
 */
export interface AccountManifestView {
  /** The Manifest row id. */
  id: string;
  /** When the manifest was snapshotted (ISO-8601). */
  generatedAt: string;
  routeId: string | null;
  routeStopId: string | null;
  /** The stop's sequence on its route. */
  stopSeq: number | null;
  /** RouteStopStatus of the snapshotted stop (PENDING…COMPLETED/FAILED/SKIPPED), or null. */
  stopStatus: string | null;
  /** RouteStopKind of the stop (PICKUP / DELIVERY), or null. */
  stopKind: string | null;
  orderId: string | null;
  siteName: string | null;
  /** Expected item count from the manifest lines (the driver's load-sheet size). */
  expectedItemCount: number;
}

export interface AccountManifestsResult {
  manifests: AccountManifestView[];
}
