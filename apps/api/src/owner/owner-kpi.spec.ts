import { businessDayStart, formatMoney, onTimePercent, sumCents, toCents, windowEnd } from './owner-kpi';

describe('owner-kpi (pure)', () => {
  describe('businessDayStart', () => {
    it('America/Toronto in summer (EDT, UTC-4): day starts at 04:00 UTC', () => {
      // 2026-06-26 15:00Z is 11:00 EDT on Jun 26 → day start = Jun 26 00:00 EDT = 04:00Z.
      const start = businessDayStart(new Date('2026-06-26T15:00:00.000Z'), 'America/Toronto');
      expect(start.toISOString()).toBe('2026-06-26T04:00:00.000Z');
    });

    it('America/Toronto in winter (EST, UTC-5): day starts at 05:00 UTC', () => {
      const start = businessDayStart(new Date('2026-01-15T12:00:00.000Z'), 'America/Toronto');
      expect(start.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    });

    it('an early-UTC instant still maps to the correct LOCAL calendar day', () => {
      // 2026-06-26 02:00Z is 2026-06-25 22:00 EDT → the local day is still Jun 25 → start 2026-06-25 04:00Z.
      const start = businessDayStart(new Date('2026-06-26T02:00:00.000Z'), 'America/Toronto');
      expect(start.toISOString()).toBe('2026-06-25T04:00:00.000Z');
    });

    it('UTC timezone: day starts at 00:00 UTC', () => {
      const start = businessDayStart(new Date('2026-06-26T15:00:00.000Z'), 'UTC');
      expect(start.toISOString()).toBe('2026-06-26T00:00:00.000Z');
    });
  });

  describe('money', () => {
    it('toCents rounds half-up and is NaN-safe', () => {
      expect(toCents('293.80')).toBe(29380);
      expect(toCents('0.005')).toBe(1);
      expect(toCents('not-a-number')).toBe(0);
    });

    it('sumCents adds exactly (no float drift) and formatMoney round-trips', () => {
      const cents = sumCents(['0.10', '0.20', '293.80', '10.00']);
      expect(cents).toBe(30410);
      expect(formatMoney(cents)).toBe('304.10');
    });

    it('formatMoney on an empty sum is 0.00', () => {
      expect(formatMoney(sumCents([]))).toBe('0.00');
    });
  });

  describe('onTimePercent', () => {
    const at = (s: string) => new Date(s);
    it('is null when no completed stop carried a window', () => {
      expect(onTimePercent([{ completedAt: at('2026-06-26T10:00:00Z'), windowEnd: null }])).toBeNull();
      expect(onTimePercent([])).toBeNull();
    });

    it('counts only window-bearing stops and rounds to a whole %', () => {
      const stops = [
        { completedAt: at('2026-06-26T10:00:00Z'), windowEnd: at('2026-06-26T11:00:00Z') }, // on time
        { completedAt: at('2026-06-26T12:30:00Z'), windowEnd: at('2026-06-26T12:00:00Z') }, // late
        { completedAt: at('2026-06-26T09:00:00Z'), windowEnd: at('2026-06-26T09:00:00Z') }, // on time (== end)
        { completedAt: at('2026-06-26T09:00:00Z'), windowEnd: null }, // excluded (no window)
      ];
      expect(onTimePercent(stops)).toBe(67); // 2 of 3 measurable
    });
  });

  describe('windowEnd', () => {
    it('parses { end } ISO out of a timeWindow JSON', () => {
      expect(windowEnd({ start: '2026-06-26T10:00:00Z', end: '2026-06-26T11:00:00Z' })?.toISOString()).toBe(
        '2026-06-26T11:00:00.000Z',
      );
    });
    it('returns null for missing/invalid windows', () => {
      expect(windowEnd(null)).toBeNull();
      expect(windowEnd({})).toBeNull();
      expect(windowEnd({ end: 'garbage' })).toBeNull();
      expect(windowEnd('not-an-object')).toBeNull();
    });
  });
});
