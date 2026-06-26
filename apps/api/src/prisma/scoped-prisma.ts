import type { PrismaClient } from '@prisma/client';
import { isOrgWide } from '../auth/rbac/policy';
import type { RequestPrincipal } from '../auth/rbac/types';

/**
 * Row-level scoping as a Prisma client extension (PRD §8.1, §17.3) — the
 * can't-be-forgotten guardrail. Enforced on EVERY operation:
 *   • reads/by-filter mutations: `where` is merged with the principal's org (+ account/site
 *     for confined principals), so a cross-tenant fetch (incl. findUnique by id) returns null.
 *   • creates (create/createMany/upsert): `org_id` is FORCED onto the data and a confined
 *     principal's account-bearing writes are validated to stay within their accounts.
 *
 * Org confinement applies to ALL models. Account confinement (for non-org-wide principals)
 * applies to account-bearing models directly, and to their children via relation paths.
 * NOTE (Increment 3): user-owned models (Message/Notification/Device) get userId scoping in
 * their dedicated services, and nested relation writes through update() are not deep-scoped
 * here — domain mutation services will own those as the endpoints land (with tests).
 */

/** Models whose account linkage is a direct scalar column. */
const ACCOUNT_DIRECT: Record<string, string> = {
  Order: 'accountId',
  Site: 'accountId',
  Invoice: 'accountId',
  RouteStop: 'accountId',
  Account: 'id',
  StandingOrder: 'accountId',
};

/** Models whose account linkage is reachable via a relation path. */
const ACCOUNT_VIA: Record<string, (filter: unknown) => Record<string, unknown>> = {
  OrderLine: (f) => ({ order: { accountId: f } }),
  // Track-B: an item is account-linked via its order (specialty) OR via its resident's site (a
  // care-home garment, which has no order). Existing specialty items match the order arm unchanged.
  Item: (f) => ({ OR: [{ order: { accountId: f } }, { resident: { site: { accountId: f } } }] }),
  Quote: (f) => ({ order: { accountId: f } }),
  Payment: (f) => ({ order: { accountId: f } }),
  Claim: (f) => ({ order: { accountId: f } }),
  Photo: (f) => ({ order: { accountId: f } }),
  Inspection: (f) => ({ item: { order: { accountId: f } } }),
  CustodyEvent: (f) => ({ item: { OR: [{ order: { accountId: f } }, { resident: { site: { accountId: f } } }] } }),
  GeofenceEvent: (f) => ({ routeStop: { accountId: f } }),
  ProofOfDelivery: (f) => ({ routeStop: { accountId: f } }),
  StandingOrderOccurrence: (f) => ({ standingOrder: { accountId: f } }),
  // Track-B (care homes): residents + lost&found are account-linked via their site.
  Resident: (f) => ({ site: { accountId: f } }),
  LostFoundItem: (f) => ({ site: { accountId: f } }),
};

/** Models that also carry a direct siteId (for SITE-scoped principals). */
const SITE_DIRECT: Record<string, string> = { Order: 'siteId', RouteStop: 'siteId', Site: 'id', Resident: 'siteId', LostFoundItem: 'siteId' };

// Unique-where ops keep the unique field at the TOP level (Prisma requires it), so scope is
// flat-merged as sibling filters (extendedWhereUnique). Filter ops AND-merge so a caller can't widen.
const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete']);
const FILTER_WHERE_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/** Build the `where` fragment a principal is confined to for a given model (exported for tests). */
export function buildReadScope(model: string, principal: RequestPrincipal): Record<string, unknown> {
  const where: Record<string, unknown> = { orgId: principal.orgId };
  if (isOrgWide(principal.roles)) return where; // org-wide staff: org boundary only

  const accFilter = { in: principal.accountIds };
  if (ACCOUNT_DIRECT[model]) {
    where[ACCOUNT_DIRECT[model]] = accFilter;
  } else if (ACCOUNT_VIA[model]) {
    Object.assign(where, ACCOUNT_VIA[model](accFilter));
  }
  if (principal.siteIds.length > 0 && SITE_DIRECT[model]) {
    where[SITE_DIRECT[model]] = { in: principal.siteIds };
  }
  return where;
}

/**
 * Force tenant scope onto a write payload (create OR update). `org_id` is always pinned
 * to the principal's org, so no write (create/update/updateMany/upsert) can move a row to
 * another org or reassign one in. For confined principals, a direct account field cannot be
 * set/reassigned outside their accounts.
 *
 * NOTE (Increment 3): cross-ACCOUNT (same-org) WRITES to account-VIA child models
 * (OrderLine/Item/Quote/… via a parent FK) require a parent-ownership lookup and must go
 * through the domain mutation services (which validate the parent), not raw scoped writes.
 * The org boundary is fully enforced here for every write; that account-child gap is latent
 * (no write endpoints route through this client until Increment 3).
 */
export function forceWriteScope(model: string, principal: RequestPrincipal, data: Record<string, unknown>): void {
  data.orgId = principal.orgId;
  if (isOrgWide(principal.roles)) return;
  const field = ACCOUNT_DIRECT[model];
  if (field && field !== 'id' && data[field] !== undefined && !principal.accountIds.includes(data[field] as string)) {
    throw new Error(`row-scoping: cannot write ${model} for an account outside the principal's scope`);
  }
}

export type ScopedPrisma = ReturnType<typeof scopedPrisma>;

export function scopedPrisma(base: PrismaClient, principal: RequestPrincipal) {
  return base.$extends({
    name: 'row-scoping',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const a = (args ?? {}) as {
            where?: Record<string, unknown>;
            data?: unknown;
            create?: unknown;
            update?: unknown;
          };

          // ── WHERE scoping (reads + by-filter mutations) ──
          if (UNIQUE_WHERE_OPS.has(operation)) {
            // Flat-merge: keep the unique field at top level; scope keys win (no widening).
            a.where = { ...(a.where ?? {}), ...buildReadScope(model, principal) };
          } else if (FILTER_WHERE_OPS.has(operation)) {
            const scope = buildReadScope(model, principal);
            // AND so a caller-supplied where can NEVER widen past the scope.
            a.where = a.where ? { AND: [a.where, scope] } : scope;
          } else if (operation === 'upsert') {
            a.where = { ...(a.where ?? {}), ...buildReadScope(model, principal) };
          }

          // ── DATA scoping (every write path forces tenant scope) ──
          if (operation === 'create' && a.data) {
            forceWriteScope(model, principal, a.data as Record<string, unknown>);
          } else if (operation === 'createMany' && Array.isArray(a.data)) {
            a.data.forEach((d) => forceWriteScope(model, principal, d as Record<string, unknown>));
          } else if ((operation === 'update' || operation === 'updateMany') && a.data) {
            forceWriteScope(model, principal, a.data as Record<string, unknown>);
          } else if (operation === 'upsert') {
            if (a.create) forceWriteScope(model, principal, a.create as Record<string, unknown>);
            if (a.update) forceWriteScope(model, principal, a.update as Record<string, unknown>);
          }

          return query(a);
        },
      },
    },
  });
}
