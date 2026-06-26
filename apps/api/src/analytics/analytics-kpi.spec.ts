import {
  InvalidRangeError,
  agingBucket,
  avgDwellMinutes,
  daysBetween,
  median,
  monthsBetween,
  parseRange,
  pct,
  ratio,
  weeksBetween,
} from './analytics-kpi';

const at = (s: string) => new Date(s);

describe('analytics-kpi (pure)', () => {
  describe('parseRange', () => {
    const now = at('2026-06-26T12:00:00.000Z');

    it('defaults to the last N days ending now when both bounds are omitted', () => {
      const { from, to } = parseRange(undefined, undefined, now, 30);
      expect(to.toISOString()).toBe('2026-06-26T12:00:00.000Z');
      expect(from.toISOString()).toBe('2026-05-27T12:00:00.000Z'); // 30 days earlier
    });

    it('uses [from, now) when only from is given', () => {
      const { from, to } = parseRange('2026-06-01T00:00:00.000Z', undefined, now, 30);
      expect(from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2026-06-26T12:00:00.000Z');
    });

    it('uses [to − N days, to) when only to is given', () => {
      const { from, to } = parseRange(undefined, '2026-04-01T00:00:00.000Z', now, 10);
      expect(to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(from.toISOString()).toBe('2026-03-22T00:00:00.000Z');
    });

    it('honours both explicit bounds', () => {
      const { from, to } = parseRange('2025-11-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z', now);
      expect(from.toISOString()).toBe('2025-11-01T00:00:00.000Z');
      expect(to.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    });

    it('throws on a non-ISO bound', () => {
      expect(() => parseRange('garbage', undefined, now)).toThrow(InvalidRangeError);
      expect(() => parseRange(undefined, 'not-a-date', now)).toThrow(InvalidRangeError);
    });

    it('throws when from is not strictly before to (incl. equal)', () => {
      expect(() => parseRange('2026-06-02T00:00:00Z', '2026-06-01T00:00:00Z', now)).toThrow(InvalidRangeError);
      expect(() => parseRange('2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', now)).toThrow(InvalidRangeError);
    });
  });

  describe('pct (divide-by-zero-safe percentage)', () => {
    it('is null when the denominator is 0 (never a fake 0)', () => {
      expect(pct(0, 0)).toBeNull();
      expect(pct(5, 0)).toBeNull();
    });
    it('rounds to a whole %', () => {
      expect(pct(2, 3)).toBe(67);
      expect(pct(1, 8)).toBe(13);
      expect(pct(3, 4)).toBe(75);
    });
    it('clamps numerator into [0, denominator]', () => {
      expect(pct(9, 4)).toBe(100); // can't exceed 100%
      expect(pct(-2, 4)).toBe(0);
    });
  });

  describe('ratio', () => {
    it('is null on a zero denominator', () => {
      expect(ratio(10, 0)).toBeNull();
    });
    it('rounds to the requested decimals', () => {
      expect(ratio(10, 4)).toBe(2.5);
      expect(ratio(7, 3, 2)).toBe(2.33);
      expect(ratio(7, 3, 0)).toBe(2);
    });
  });

  describe('median', () => {
    it('is null when empty', () => {
      expect(median([])).toBeNull();
    });
    it('picks the middle (odd) and averages the middle two (even)', () => {
      expect(median([5, 1, 3])).toBe(3);
      expect(median([1, 2, 3, 4])).toBe(2.5);
      expect(median([10])).toBe(10);
    });
  });

  describe('span helpers', () => {
    it('daysBetween / weeksBetween / monthsBetween', () => {
      const from = at('2026-01-01T00:00:00Z');
      const to = at('2026-01-31T00:00:00Z'); // 30 days
      expect(daysBetween(from, to)).toBeCloseTo(30, 5);
      expect(weeksBetween(from, to)).toBeCloseTo(30 / 7, 5);
      // 90-day span is above the 1-month floor so the raw calc is exercised.
      const to90 = at('2026-04-01T00:00:00Z'); // 90 days from Jan 1
      expect(monthsBetween(from, to90)).toBeCloseTo(90 / 30.4375, 5);
    });
    it('weeksBetween floors at 1/7 (a single day never divides by ~0)', () => {
      const d = at('2026-01-01T00:00:00Z');
      const d2 = at('2026-01-01T01:00:00Z'); // 1 hour
      expect(weeksBetween(d, d2)).toBeCloseTo(1 / 7, 5);
    });
    it('monthsBetween floors at 1', () => {
      const d = at('2026-01-01T00:00:00Z');
      const d2 = at('2026-01-02T00:00:00Z'); // 1 day
      expect(monthsBetween(d, d2)).toBe(1);
    });
  });

  describe('agingBucket', () => {
    const asOf = at('2026-06-30T00:00:00Z');
    it('is current when not yet due or no due date', () => {
      expect(agingBucket(null, asOf)).toBe('current');
      expect(agingBucket(at('2026-07-15T00:00:00Z'), asOf)).toBe('current'); // future due
    });
    it('buckets by age in days', () => {
      expect(agingBucket(at('2026-06-15T00:00:00Z'), asOf)).toBe('1-30'); // 15 days
      expect(agingBucket(at('2026-05-15T00:00:00Z'), asOf)).toBe('31-60'); // 46 days
      expect(agingBucket(at('2026-04-15T00:00:00Z'), asOf)).toBe('61-90'); // 76 days
      expect(agingBucket(at('2026-01-15T00:00:00Z'), asOf)).toBe('90+'); // ~166 days
    });
  });

  describe('avgDwellMinutes', () => {
    it('is null when no stop has a measurable interval', () => {
      expect(avgDwellMinutes([])).toBeNull();
      expect(avgDwellMinutes([{ arrivedAt: at('2026-06-26T10:00:00Z'), departedAt: null }])).toBeNull();
    });
    it('averages departed−arrived in minutes and drops negative intervals', () => {
      const stops = [
        { arrivedAt: at('2026-06-26T10:00:00Z'), departedAt: at('2026-06-26T10:20:00Z') }, // 20 min
        { arrivedAt: at('2026-06-26T11:00:00Z'), departedAt: at('2026-06-26T11:10:00Z') }, // 10 min
        { arrivedAt: at('2026-06-26T12:00:00Z'), departedAt: at('2026-06-26T11:00:00Z') }, // -60 (dropped)
        { arrivedAt: null, departedAt: at('2026-06-26T12:10:00Z') }, // unmeasurable (dropped)
      ];
      expect(avgDwellMinutes(stops)).toBe(15); // (20 + 10) / 2
    });
  });
});
