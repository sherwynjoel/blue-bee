import { RoleType, type MeResponse } from '@blue-bee/shared';

/**
 * UI role-gating (Increment 13) — MIRRORS the server's §17.3 RBAC. This is UX only: every endpoint is
 * independently role-gated server-side, so a tampered client can never act beyond its grants — the UI
 * gating just avoids showing actions that would 403. Role groups match the as-built controllers.
 */
export const OPS_ROLES: RoleType[] = [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR, RoleType.PLANT_OP, RoleType.FINANCE];
export const INTAKE_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP];
export const DISPATCH_ROLES: RoleType[] = [RoleType.OWNER, RoleType.DISPATCHER];
export const FLEET_READ_ROLES: RoleType[] = [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR];
export const FINANCE_ROLES: RoleType[] = [RoleType.OWNER, RoleType.FINANCE];
// Analytics (Inc 15) — MIRRORS the server's per-dashboard @Roles (analytics.controller.ts).
export const ANALYTICS_OPERATIONAL_ROLES: RoleType[] = [
  RoleType.OWNER,
  RoleType.DISPATCHER,
  RoleType.CSR,
  RoleType.PLANT_OP,
  RoleType.FINANCE,
];
export const ANALYTICS_COMMERCIAL_ROLES: RoleType[] = [RoleType.OWNER, RoleType.FINANCE];
export const ANALYTICS_SCORECARD_ROLES: RoleType[] = [RoleType.OWNER, RoleType.FINANCE, RoleType.CSR];
// Admin (Inc 16) — OWNER only (§17.3 admin row), mirrors the server @Roles(OWNER).
export const ADMIN_ROLES: RoleType[] = [RoleType.OWNER];
// Track-A B2B accounts console — MIRRORS the server @Roles on the account/standing-order/billing routes.
// Account directory reads + the generated feed: org-wide ops + finance staff.
export const ACCOUNTS_READ_ROLES: RoleType[] = [RoleType.OWNER, RoleType.FINANCE, RoleType.DISPATCHER, RoleType.CSR];
// Standing-order management (create/edit/delete/run): ops (OWNER/DISPATCHER).
export const STANDING_ORDER_WRITE_ROLES: RoleType[] = [RoleType.OWNER, RoleType.DISPATCHER];
// Billing terms + batch invoicing reuse the finance gate (FINANCE_ROLES = OWNER/FINANCE).
// Track-B care homes (resident personal clothing) — MIRRORS the server @Roles on the residents routes.
// Resident PII reads: ops + the account's own staff (their site only). Garment lifecycle ops: plant.
export const RESIDENT_READ_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];
export const GARMENT_OPS_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP];
// B2B self-serve invoice portal — the account-customer persona (NOT ops). Mirrors the server @Roles on
// /v1/invoices (ACCOUNT_ADMIN/ACCOUNT_STAFF self-serve; OWNER/FINANCE also read for support).
export const PORTAL_ROLES: RoleType[] = [RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];
// Track-B facility linen (care-home par loop) — MIRRORS the server @Roles on /v1/sites/:id/par-levels,
// /linen-stock, /soil-pickups, /pack-to-par. Reads: ops + the account's own staff (their sites only). Par
// is account-management (OWNER/CSR); on-hand corrections are plant/ops; pickups + generation are ops.
export const FACILITY_LINEN_READ_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.DISPATCHER, RoleType.PLANT_OP, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF];
export const PAR_WRITE_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR];
export const STOCK_ADJUST_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP];
export const LINEN_OPS_ROLES: RoleType[] = [RoleType.OWNER, RoleType.CSR, RoleType.DISPATCHER];

export function roleNames(me: MeResponse | null): RoleType[] {
  return me ? me.user.roles.map((r) => r.role) : [];
}

export function hasAnyRole(me: MeResponse | null, allowed: RoleType[]): boolean {
  const have = roleNames(me);
  return have.some((r) => allowed.includes(r));
}

/** Whether this principal may reach the ops console at all (a customer-only token gets nothing). */
export function isOps(me: MeResponse | null): boolean {
  return hasAnyRole(me, OPS_ROLES);
}

/** Whether this principal is a B2B account customer — the self-serve invoice portal audience. */
export function isPortal(me: MeResponse | null): boolean {
  return hasAnyRole(me, PORTAL_ROLES);
}

export const can = {
  intake: (me: MeResponse | null) => hasAnyRole(me, INTAKE_ROLES),
  dispatch: (me: MeResponse | null) => hasAnyRole(me, DISPATCH_ROLES),
  fleet: (me: MeResponse | null) => hasAnyRole(me, FLEET_READ_ROLES),
  finance: (me: MeResponse | null) => hasAnyRole(me, FINANCE_ROLES),
  // Analytics — `analytics` gates the nav (any dashboard); the three sub-checks gate each section.
  analytics: (me: MeResponse | null) => hasAnyRole(me, ANALYTICS_OPERATIONAL_ROLES),
  analyticsOperational: (me: MeResponse | null) => hasAnyRole(me, ANALYTICS_OPERATIONAL_ROLES),
  analyticsCommercial: (me: MeResponse | null) => hasAnyRole(me, ANALYTICS_COMMERCIAL_ROLES),
  analyticsScorecard: (me: MeResponse | null) => hasAnyRole(me, ANALYTICS_SCORECARD_ROLES),
  admin: (me: MeResponse | null) => hasAnyRole(me, ADMIN_ROLES),
  // Track-A B2B accounts console.
  accounts: (me: MeResponse | null) => hasAnyRole(me, ACCOUNTS_READ_ROLES),
  standingOrderWrite: (me: MeResponse | null) => hasAnyRole(me, STANDING_ORDER_WRITE_ROLES),
  // Corporate accounts + rate cards (Inc-15) — OWNER/FINANCE, mirrors @Roles(OWNER, FINANCE) on /v1/corporate.
  corporate: (me: MeResponse | null) => hasAnyRole(me, FINANCE_ROLES),
  // Service zones + coverage requests (Inc-19) — OWNER/FINANCE, mirrors @Roles(OWNER, FINANCE) on
  // /v1/service-zones + /v1/coverage-requests.
  zones: (me: MeResponse | null) => hasAnyRole(me, FINANCE_ROLES),
  // Dry-clean visual catalog admin (Inc-17) — OWNER/FINANCE, mirrors @Roles(OWNER, FINANCE) on /v1/catalog.
  catalog: (me: MeResponse | null) => hasAnyRole(me, FINANCE_ROLES),
  // Track-B care homes — resident personal clothing.
  residents: (me: MeResponse | null) => hasAnyRole(me, RESIDENT_READ_ROLES),
  garmentOps: (me: MeResponse | null) => hasAnyRole(me, GARMENT_OPS_ROLES),
  // B2B self-serve invoice portal.
  portal: (me: MeResponse | null) => hasAnyRole(me, PORTAL_ROLES),
  // Track-B facility linen (care-home par loop). `facilityLinen` gates the nav (read); the finer checks
  // gate each write (par set/update, on-hand adjust, pickup + load-sheet generation).
  facilityLinen: (me: MeResponse | null) => hasAnyRole(me, FACILITY_LINEN_READ_ROLES),
  parWrite: (me: MeResponse | null) => hasAnyRole(me, PAR_WRITE_ROLES),
  stockAdjust: (me: MeResponse | null) => hasAnyRole(me, STOCK_ADJUST_ROLES),
  linenOps: (me: MeResponse | null) => hasAnyRole(me, LINEN_OPS_ROLES),
};
