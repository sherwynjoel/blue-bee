import { RoleScope, RoleType } from '@blue-bee/shared';
import { buildReadScope, forceWriteScope } from './scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';

const base = { userId: 'u', jti: 'j', accessExp: 0 };
const orgWide: RequestPrincipal = {
  ...base,
  orgId: 'org1',
  roles: [{ role: RoleType.OWNER, scope: RoleScope.ORG, scopeId: null }],
  accountIds: [],
  siteIds: [],
};
const confined: RequestPrincipal = {
  ...base,
  orgId: 'org1',
  roles: [{ role: RoleType.RESIDENTIAL_CUSTOMER, scope: RoleScope.ACCOUNT, scopeId: 'acctA' }],
  accountIds: ['acctA'],
  siteIds: [],
};

describe('buildReadScope', () => {
  it('org-wide principal is scoped to org only (no account filter)', () => {
    expect(buildReadScope('Order', orgWide)).toEqual({ orgId: 'org1' });
    expect(buildReadScope('OrderLine', orgWide)).toEqual({ orgId: 'org1' });
  });

  it('confined principal gets a direct accountId filter on account-bearing models', () => {
    expect(buildReadScope('Order', confined)).toEqual({ orgId: 'org1', accountId: { in: ['acctA'] } });
    expect(buildReadScope('Account', confined)).toEqual({ orgId: 'org1', id: { in: ['acctA'] } });
  });

  it('confined principal scopes child models via their relation path', () => {
    expect(buildReadScope('OrderLine', confined)).toEqual({ orgId: 'org1', order: { accountId: { in: ['acctA'] } } });
    expect(buildReadScope('Inspection', confined)).toEqual({
      orgId: 'org1',
      item: { order: { accountId: { in: ['acctA'] } } },
    });
  });

  it('models with no account linkage fall back to org-only for confined principals', () => {
    expect(buildReadScope('User', confined)).toEqual({ orgId: 'org1' });
  });

  it('applies site confinement when siteIds are present', () => {
    const siteScoped: RequestPrincipal = { ...confined, siteIds: ['site1'] };
    expect(buildReadScope('Order', siteScoped)).toEqual({
      orgId: 'org1',
      accountId: { in: ['acctA'] },
      siteId: { in: ['site1'] },
    });
  });

  it('confined principal with empty accountIds matches nothing (fail-closed)', () => {
    const driver: RequestPrincipal = {
      ...base,
      orgId: 'org1',
      roles: [{ role: RoleType.DRIVER, scope: RoleScope.ORG, scopeId: null }],
      accountIds: [],
      siteIds: [],
    };
    expect(buildReadScope('Order', driver)).toEqual({ orgId: 'org1', accountId: { in: [] } });
  });
});

describe('forceWriteScope (write-side tenant enforcement)', () => {
  it('forces org_id onto every write payload (create + update)', () => {
    const d: Record<string, unknown> = { name: 'x', orgId: 'attacker-org' };
    forceWriteScope('Account', orgWide, d);
    expect(d.orgId).toBe('org1'); // attacker-supplied org overwritten
  });

  it('forces the principal org even for confined writes', () => {
    const d: Record<string, unknown> = { accountId: 'acctA' };
    forceWriteScope('Order', confined, d);
    expect(d.orgId).toBe('org1');
  });

  it('rejects a confined principal writing an account-direct row outside scope', () => {
    expect(() => forceWriteScope('Order', confined, { accountId: 'acctB' })).toThrow(/outside the principal/);
  });

  it('allows a confined principal writing within their own account', () => {
    expect(() => forceWriteScope('Order', confined, { accountId: 'acctA' })).not.toThrow();
  });
});
