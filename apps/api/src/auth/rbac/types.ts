import type { RoleGrant } from '@blue-bee/shared';

/**
 * The authenticated principal attached to the request by JwtAuthGuard, derived
 * purely from verified access-token claims (no DB hit). Profile fields
 * (name/email/phone) are NOT in the token — endpoints that need them load the user.
 */
export interface RequestPrincipal {
  userId: string;
  orgId: string;
  roles: RoleGrant[];
  accountIds: string[];
  siteIds: string[];
  /** Access-token id + expiry (unix seconds) — used to denylist the live token on logout. */
  jti: string;
  accessExp: number;
}
