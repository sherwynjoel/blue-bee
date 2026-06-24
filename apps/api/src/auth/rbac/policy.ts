import { RoleType } from '@blue-bee/shared';

/**
 * Central RBAC policy — the executable form of PRD §3.3 + §17.3.
 *
 * Two scoping classes drive row-level access:
 *  • ORG_WIDE_ROLES  — staff who may read across the whole org (§17.3 "View all orders ✓").
 *  • ACCOUNT_ROLES   — customer-side principals confined to their own account_id/site_id.
 * DRIVER is org-staff but sees only its OWN resources (own stops); until routes/stops
 * exist (Increment 4) a driver has no direct order access, so it is treated as confined
 * with no accounts (sees nothing it isn't assigned).
 */
export const ORG_WIDE_ROLES: readonly RoleType[] = [
  RoleType.OWNER,
  RoleType.DISPATCHER,
  RoleType.CSR,
  RoleType.PLANT_OP,
  RoleType.FINANCE,
];

export const ACCOUNT_ROLES: readonly RoleType[] = [
  RoleType.ACCOUNT_ADMIN,
  RoleType.ACCOUNT_STAFF,
  RoleType.RESIDENTIAL_CUSTOMER,
];

/** True if any of the principal's roles grant org-wide read scope. */
export function isOrgWide(roles: ReadonlyArray<{ role: RoleType }>): boolean {
  return roles.some((r) => ORG_WIDE_ROLES.includes(r.role));
}

/**
 * §17.3 capability → allowed roles. Endpoints declare a capability via @Roles
 * (Increment 2 wires the auth/admin rows; order/route/billing rows are listed so
 * Increment 3+ endpoints slot in without touching the guard).
 */
export const CAPABILITY_ROLES = {
  VIEW_ALL_ORDERS: [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR, RoleType.PLANT_OP, RoleType.FINANCE],
  BUILD_ROUTES: [RoleType.OWNER, RoleType.DISPATCHER],
  INTAKE_INSPECT_QUOTE: [RoleType.OWNER, RoleType.CSR, RoleType.PLANT_OP],
  APPROVE_THRESHOLD: [RoleType.OWNER],
  PRODUCTION: [RoleType.OWNER, RoleType.PLANT_OP],
  DRIVER_SCAN_POD: [RoleType.OWNER, RoleType.DRIVER],
  INVOICING: [RoleType.OWNER, RoleType.FINANCE],
  MANAGE_CONTRACTS: [RoleType.OWNER, RoleType.CSR],
  ADMIN_USERS: [RoleType.OWNER],
} as const satisfies Record<string, RoleType[]>;
