import { localMinutesOfDay, isWithinQuietHours, quietHoursEndAt } from './quiet-hours';

const TZ = 'America/Toronto';

describe('quiet-hours math (Increment 8)', () => {
  // 2026-06-24T02:30:00Z → EDT (UTC-4 in June) → 22:30 local the previous day → 1350 min.
  const instant = new Date('2026-06-24T02:30:00Z');

  it('localMinutesOfDay converts a UTC instant to local minutes-from-midnight', () => {
    expect(localMinutesOfDay(instant, TZ)).toBe(22 * 60 + 30); // 1350
  });

  it('localMinutesOfDay respects the timezone (UTC reads differently)', () => {
    expect(localMinutesOfDay(instant, 'UTC')).toBe(2 * 60 + 30); // 150
  });

  describe('isWithinQuietHours', () => {
    it('unset window ⇒ never in quiet hours', () => {
      expect(isWithinQuietHours(instant, TZ, null, null)).toBe(false);
      expect(isWithinQuietHours(instant, TZ, 1320, null)).toBe(false);
    });

    it('empty window (start === end) ⇒ never in quiet hours', () => {
      expect(isWithinQuietHours(instant, TZ, 600, 600)).toBe(false);
    });

    it('same-day window [09:00, 17:00)', () => {
      const noon = new Date('2026-06-24T16:00:00Z'); // 12:00 EDT
      expect(isWithinQuietHours(noon, TZ, 540, 1020)).toBe(true);
      const evening = new Date('2026-06-24T23:00:00Z'); // 19:00 EDT
      expect(isWithinQuietHours(evening, TZ, 540, 1020)).toBe(false);
    });

    it('window that wraps midnight [22:00, 07:00)', () => {
      // 22:30 local → inside
      expect(isWithinQuietHours(instant, TZ, 1320, 420)).toBe(true);
      // 06:40 local (10:40Z) → inside
      expect(isWithinQuietHours(new Date('2026-06-24T10:40:00Z'), TZ, 1320, 420)).toBe(true);
      // 12:00 local (16:00Z) → outside
      expect(isWithinQuietHours(new Date('2026-06-24T16:00:00Z'), TZ, 1320, 420)).toBe(false);
    });
  });

  it('quietHoursEndAt returns the next local end-of-window instant', () => {
    // 22:30 local, window ends 07:00 → +8.5h, landing at local 07:00.
    const end = quietHoursEndAt(instant, TZ, 420);
    expect(localMinutesOfDay(end, TZ)).toBe(420);
    expect(end.getTime()).toBe(instant.getTime() + 510 * 60_000); // 8.5h (no DST change in June)
  });

  it('quietHoursEndAt is DST-correct on the fall-back night (lands AT 07:00 local, not 1h inside the window)', () => {
    // 2026-11-01 02:00 EDT → clocks fall back to 01:00 EST. At = Oct 31 23:00 EDT (= Nov 1 03:00Z),
    // inside the 22:00→07:00 window. A naive UTC minute-delta would land at 06:00 local (still inside);
    // the DST-correct result must land at exactly 07:00 local (window end), so it is NOT in quiet hours.
    const at = new Date('2026-11-01T03:00:00Z');
    expect(isWithinQuietHours(at, TZ, 1320, 420)).toBe(true); // 23:00 local — inside
    const end = quietHoursEndAt(at, TZ, 420);
    expect(localMinutesOfDay(end, TZ)).toBe(420); // exactly 07:00 local
    expect(isWithinQuietHours(end, TZ, 1320, 420)).toBe(false); // genuinely OUT of the window
    // and it is LATER than the naive +480min estimate (which would have been 1h early / inside)
    expect(end.getTime()).toBeGreaterThan(at.getTime() + 480 * 60_000);
  });
});
