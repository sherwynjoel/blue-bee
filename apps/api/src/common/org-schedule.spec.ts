import { DEFAULT_PICKUP_SCHEDULE, type OrgSchedule } from '@blue-bee/shared';
import { FALLBACK_BUSINESS_TZ, resolveBusinessTz, resolveOrgSchedule, withSchedule } from './org-schedule';

const REAL: OrgSchedule = {
  windows: [
    { label: 'Early', start: '07:00', end: '10:00' },
    { label: 'Late', start: '16:00', end: '20:00' },
  ],
  leadTimeHours: 4,
  horizonDays: 10,
  maxPerSlot: 6,
  closedDays: [0],
};

describe('org-schedule (pure)', () => {
  const envTz = process.env.OWNER_BUSINESS_TZ;
  afterEach(() => {
    if (envTz === undefined) delete process.env.OWNER_BUSINESS_TZ;
    else process.env.OWNER_BUSINESS_TZ = envTz;
  });

  describe('resolveBusinessTz', () => {
    it('prefers Organization.settings.tz', () => {
      process.env.OWNER_BUSINESS_TZ = 'America/Vancouver';
      expect(resolveBusinessTz({ settings: { tz: 'America/Halifax' } })).toBe('America/Halifax');
    });

    it('falls back to the env var, then to America/Toronto', () => {
      process.env.OWNER_BUSINESS_TZ = 'America/Vancouver';
      expect(resolveBusinessTz({ settings: {} })).toBe('America/Vancouver');
      delete process.env.OWNER_BUSINESS_TZ;
      expect(resolveBusinessTz({ settings: {} })).toBe(FALLBACK_BUSINESS_TZ);
      expect(resolveBusinessTz({ settings: null })).toBe(FALLBACK_BUSINESS_TZ);
    });

    it('treats a blank tz as unset rather than handing whitespace to Intl', () => {
      delete process.env.OWNER_BUSINESS_TZ;
      expect(resolveBusinessTz({ settings: { tz: '   ' } })).toBe(FALLBACK_BUSINESS_TZ);
    });

    it('throws, naming the culprit, when the configured tz is not a real IANA zone', () => {
      expect(() => resolveBusinessTz({ settings: { tz: 'Mars/Olympus_Mons' } })).toThrow(
        /Configured business timezone "Mars\/Olympus_Mons" is not a valid IANA timezone/,
      );
    });
  });

  describe('resolveOrgSchedule', () => {
    it('serves the founder\'s saved schedule and labels it `org`', () => {
      const r = resolveOrgSchedule({ settings: { tz: 'America/Toronto', schedule: REAL } });
      expect(r.schedule).toEqual(REAL);
      expect(r.source).toBe('org');
      expect(r.timezone).toBe('America/Toronto');
    });

    it('serves the documented default, LABELLED as a default, when nothing is saved', () => {
      const r = resolveOrgSchedule({ settings: { tz: 'America/Toronto' } });
      expect(r.schedule).toEqual(DEFAULT_PICKUP_SCHEDULE);
      expect(r.source).toBe('default');
    });

    it('the default never fabricates a capacity cap', () => {
      expect(resolveOrgSchedule({ settings: {} }).schedule.maxPerSlot).toBeNull();
    });

    /**
     * Only a hand-edit of the DB can store an invalid schedule (the PATCH validates on the same schema).
     * Booking must not go down org-wide for it — and the fallback must not masquerade as the founder's hours.
     */
    it.each([
      ['overlapping windows', { windows: [{ label: 'A', start: '09:00', end: '13:00' }, { label: 'B', start: '12:00', end: '15:00' }], leadTimeHours: 2, horizonDays: 7, maxPerSlot: null, closedDays: [] }],
      ['no windows', { windows: [], leadTimeHours: 2, horizonDays: 7, maxPerSlot: null, closedDays: [] }],
      ['end before start', { windows: [{ label: 'A', start: '15:00', end: '09:00' }], leadTimeHours: 2, horizonDays: 7, maxPerSlot: null, closedDays: [] }],
      ['a zero cap', { windows: DEFAULT_PICKUP_SCHEDULE.windows, leadTimeHours: 2, horizonDays: 7, maxPerSlot: 0, closedDays: [] }],
      ['every day closed', { windows: DEFAULT_PICKUP_SCHEDULE.windows, leadTimeHours: 2, horizonDays: 7, maxPerSlot: null, closedDays: [0, 1, 2, 3, 4, 5, 6] }],
      ['not an object', 'nine to five'],
      ['null', null],
    ])('falls back to the default (source=default), not a throw, for %s', (_name, schedule) => {
      const r = resolveOrgSchedule({ settings: { schedule } });
      expect(r.schedule).toEqual(DEFAULT_PICKUP_SCHEDULE);
      expect(r.source).toBe('default');
    });
  });

  describe('withSchedule', () => {
    it('preserves the sibling settings bootstrap wrote', () => {
      const merged = withSchedule({ region: 'GTA', currency: 'CAD', tz: 'America/Toronto' }, REAL);
      expect(merged).toEqual({ region: 'GTA', currency: 'CAD', tz: 'America/Toronto', schedule: REAL });
    });

    it('replaces an existing schedule wholesale (a PATCH is not a window merge)', () => {
      const merged = withSchedule({ schedule: DEFAULT_PICKUP_SCHEDULE, tz: 'UTC' }, REAL);
      expect(merged.schedule).toEqual(REAL);
      expect(merged.tz).toBe('UTC');
    });

    it('tolerates null/absent settings', () => {
      expect(withSchedule(null, REAL)).toEqual({ schedule: REAL });
    });
  });
});
