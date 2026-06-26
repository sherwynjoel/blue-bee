import { RoleScope } from '@blue-bee/shared';
import { AdminInputError, clampLimit, maskPushToken, normalizeGrantScope, parseOptionalDate } from './admin-policy';

describe('admin-policy (pure)', () => {
  describe('normalizeGrantScope', () => {
    it('ORG: returns null and rejects a stray scopeId', () => {
      expect(normalizeGrantScope(RoleScope.ORG, null)).toBeNull();
      expect(normalizeGrantScope(RoleScope.ORG, undefined)).toBeNull();
      expect(() => normalizeGrantScope(RoleScope.ORG, 'acc-1')).toThrow(AdminInputError);
    });
    it('ACCOUNT/SITE: requires a scopeId and returns it', () => {
      expect(normalizeGrantScope(RoleScope.ACCOUNT, 'acc-1')).toBe('acc-1');
      expect(normalizeGrantScope(RoleScope.SITE, 'site-1')).toBe('site-1');
      expect(() => normalizeGrantScope(RoleScope.ACCOUNT, null)).toThrow(AdminInputError);
      expect(() => normalizeGrantScope(RoleScope.SITE, undefined)).toThrow(AdminInputError);
    });
  });

  describe('maskPushToken', () => {
    it('masks to the last 4 and never emits the full token', () => {
      expect(maskPushToken('ExponentPushToken[abc123XYZ]')).toBe('…XYZ]');
      expect(maskPushToken('ab')).toBe('…ab');
      expect(maskPushToken(null)).toBeNull();
      expect(maskPushToken(undefined)).toBeNull();
    });
  });

  describe('clampLimit', () => {
    it('defaults on absent/invalid and clamps into [1,max]', () => {
      expect(clampLimit(undefined, 50, 200)).toBe(50);
      expect(clampLimit('0', 50, 200)).toBe(50);
      expect(clampLimit('-5', 50, 200)).toBe(50);
      expect(clampLimit('abc', 50, 200)).toBe(50);
      expect(clampLimit('25', 50, 200)).toBe(25);
      expect(clampLimit('999', 50, 200)).toBe(200);
      expect(clampLimit(10, 50, 200)).toBe(10);
    });
  });

  describe('parseOptionalDate', () => {
    it('passes undefined/empty through and parses a valid ISO', () => {
      expect(parseOptionalDate(undefined, 'from')).toBeUndefined();
      expect(parseOptionalDate('', 'from')).toBeUndefined();
      expect(parseOptionalDate('2026-06-01T00:00:00Z', 'from')?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    });
    it('throws on an invalid date', () => {
      expect(() => parseOptionalDate('not-a-date', 'to')).toThrow(AdminInputError);
    });
  });
});
