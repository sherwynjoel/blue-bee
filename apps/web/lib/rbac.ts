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
};
