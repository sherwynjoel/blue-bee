import { addDaysToDateKey, parseDateKey, tzOffsetMs, wallDateKey, weekdayInTz, weekdayOfDateKey, zonedWallTimeToUtc } from './tz';

const TO = 'America/Toronto';

describe('tz (pure)', () => {
  describe('tzOffsetMs', () => {
    it('Toronto is UTC-5 in winter (EST) and UTC-4 in summer (EDT)', () => {
      expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), TO)).toBe(-5 * 3_600_000);
      expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), TO)).toBe(-4 * 3_600_000);
    });

    it('UTC is always zero', () => {
      expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'UTC')).toBe(0);
    });
  });

  describe('zonedWallTimeToUtc', () => {
    it('resolves a winter (EST) wall time', () => {
      // 09:00 EST = 14:00Z
      expect(zonedWallTimeToUtc(2026, 1, 15, 9, 0, TO).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    });

    it('resolves a summer (EDT) wall time', () => {
      // 09:00 EDT = 13:00Z
      expect(zonedWallTimeToUtc(2026, 7, 15, 9, 0, TO).toISOString()).toBe('2026-07-15T13:00:00.000Z');
    });

    /**
     * The reason `zonedWallTimeToUtc` runs two passes. Spring-forward 2026 is 2026-03-08 02:00 EST →
     * 03:00 EDT. A single-pass conversion of "09:00 local" guesses the offset at 09:00 *UTC* — which is
     * 04:00 local, still EST — and returns 14:00Z (= 10:00 EDT). One hour late. The customer would be
     * told 9am and the driver routed for 10am.
     */
    it('spring-forward day: 09:00 local is 13:00Z, not 14:00Z (the single-pass bug)', () => {
      expect(zonedWallTimeToUtc(2026, 3, 8, 9, 0, TO).toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });

    it('fall-back day: 09:00 local is 14:00Z (EST has resumed by 09:00)', () => {
      // 2026-11-01 02:00 EDT → 01:00 EST.
      expect(zonedWallTimeToUtc(2026, 11, 1, 9, 0, TO).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    });

    it('the day either side of a transition is unaffected', () => {
      expect(zonedWallTimeToUtc(2026, 3, 7, 9, 0, TO).toISOString()).toBe('2026-03-07T14:00:00.000Z'); // EST
      expect(zonedWallTimeToUtc(2026, 3, 9, 9, 0, TO).toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
    });

    it('UTC round-trips exactly', () => {
      expect(zonedWallTimeToUtc(2026, 3, 8, 9, 0, 'UTC').toISOString()).toBe('2026-03-08T09:00:00.000Z');
    });
  });

  describe('wallDateKey', () => {
    it('maps an instant to the LOCAL calendar day, not the UTC one', () => {
      // 2026-07-11 02:00Z is 2026-07-10 22:00 EDT — still the 10th in Toronto.
      expect(wallDateKey(new Date('2026-07-11T02:00:00Z'), TO)).toBe('2026-07-10');
      expect(wallDateKey(new Date('2026-07-11T02:00:00Z'), 'UTC')).toBe('2026-07-11');
    });
  });

  describe('weekdayInTz', () => {
    it('uses the local day (2026-07-11 is a Saturday)', () => {
      expect(weekdayInTz(new Date('2026-07-11T16:00:00Z'), TO)).toBe(6);
      // 04:00Z on the 12th is still Saturday the 11th in Toronto.
      expect(weekdayInTz(new Date('2026-07-12T02:00:00Z'), TO)).toBe(6);
      expect(weekdayInTz(new Date('2026-07-12T02:00:00Z'), 'UTC')).toBe(0);
    });
  });

  describe('parseDateKey', () => {
    it('accepts a real calendar date', () => {
      expect(parseDateKey('2026-07-10')).toEqual({ year: 2026, month: 7, day: 10 });
      expect(parseDateKey('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 }); // leap year
    });

    it('rejects a well-formed but nonexistent date', () => {
      expect(parseDateKey('2026-02-30')).toBeNull();
      expect(parseDateKey('2026-13-01')).toBeNull();
      expect(parseDateKey('2026-02-29')).toBeNull(); // 2026 is not a leap year
    });

    it('rejects a malformed string', () => {
      expect(parseDateKey('2026-7-10')).toBeNull();
      expect(parseDateKey('10/07/2026')).toBeNull();
      expect(parseDateKey('')).toBeNull();
    });
  });

  describe('addDaysToDateKey', () => {
    it('crosses months, years and leap days without a timezone in sight', () => {
      expect(addDaysToDateKey('2026-07-10', 1)).toBe('2026-07-11');
      expect(addDaysToDateKey('2026-07-31', 1)).toBe('2026-08-01');
      expect(addDaysToDateKey('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDaysToDateKey('2028-02-28', 1)).toBe('2028-02-29');
      expect(addDaysToDateKey('2026-07-10', 0)).toBe('2026-07-10');
    });

    /** Whole-day key arithmetic must not lose a day to a DST transition (the 23-hour day). */
    it('steps across the spring-forward day exactly once', () => {
      expect(addDaysToDateKey('2026-03-07', 1)).toBe('2026-03-08');
      expect(addDaysToDateKey('2026-03-08', 1)).toBe('2026-03-09');
    });

    it('throws on a non-date key', () => {
      expect(() => addDaysToDateKey('2026-02-30', 1)).toThrow(/not a calendar date/);
    });
  });

  describe('weekdayOfDateKey', () => {
    it('0=Sunday … 6=Saturday', () => {
      expect(weekdayOfDateKey('2026-07-12')).toBe(0); // Sunday
      expect(weekdayOfDateKey('2026-07-10')).toBe(5); // Friday
      expect(weekdayOfDateKey('2026-07-11')).toBe(6); // Saturday
    });
  });
});
