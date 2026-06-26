/**
 * Pure admin helpers (Increment 16) — no I/O, unit-tested in `admin-policy.spec.ts`. The grant-shape
 * rule, token masking, pagination clamp, and audit-filter date parsing are factored out so they're
 * provable without a DB. The AdminService does the I/O (scoped reads + audited tx writes).
 */
import { RoleScope } from '@blue-bee/shared';

/** Thrown on a malformed role grant or audit filter — the service maps it to a 400 (problem+json). */
export class AdminInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminInputError';
  }
}

/**
 * Validate a role grant's scope/scopeId consistency and return the NORMALIZED scopeId:
 *   • ORG               → scopeId must be absent/null (returns null).
 *   • ACCOUNT / SITE    → scopeId is REQUIRED (returns it). The caller still verifies the id is an
 *                         account/site IN the principal's org (org-boundary check, DB-side).
 * Throws {@link AdminInputError} on a shape violation.
 */
export function normalizeGrantScope(scope: RoleScope, scopeId: string | null | undefined): string | null {
  if (scope === RoleScope.ORG) {
    if (scopeId != null) throw new AdminInputError('ORG-scoped role must not carry a scopeId');
    return null;
  }
  if (scopeId == null) throw new AdminInputError(`${scope}-scoped role requires a scopeId`);
  return scopeId;
}

/** Mask a push token to its last 4 chars (never emit the full token), or null when absent. */
export function maskPushToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return `…${token.slice(-4)}`;
}

/** Clamp a requested page size into `[1, max]`, defaulting when absent/invalid. */
export function clampLimit(raw: string | number | undefined, def: number, max: number): number {
  const n = typeof raw === 'number' ? raw : raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(Math.floor(n), max);
}

/** Parse an optional ISO date filter; undefined passes through, an invalid value throws. */
export function parseOptionalDate(raw: string | undefined, label: string): Date | undefined {
  if (raw === undefined || raw === '') return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new AdminInputError(`'${label}' is not a valid ISO-8601 date: ${raw}`);
  return d;
}
