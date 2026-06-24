import { RoleScope, RoleType } from '@blue-bee/shared';
import { isOrgWide } from './policy';

const grant = (role: RoleType) => ({ role, scope: RoleScope.ORG, scopeId: null });

describe('isOrgWide (PRD §17.3)', () => {
  it('is true for org-wide staff roles', () => {
    for (const role of [RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR, RoleType.PLANT_OP, RoleType.FINANCE]) {
      expect(isOrgWide([grant(role)])).toBe(true);
    }
  });

  it('is false for account-confined and driver roles', () => {
    for (const role of [RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.RESIDENTIAL_CUSTOMER, RoleType.DRIVER]) {
      expect(isOrgWide([grant(role)])).toBe(false);
    }
  });

  it('is true if ANY grant is org-wide (mixed)', () => {
    expect(isOrgWide([grant(RoleType.RESIDENTIAL_CUSTOMER), grant(RoleType.CSR)])).toBe(true);
  });

  it('is false for no roles', () => {
    expect(isOrgWide([])).toBe(false);
  });
});
