import { DEFAULT_PICKUP_SCHEDULE, type OrgSchedule } from '@blue-bee/shared';
import { bookableDates, clockReason, daySlots, isWithinHorizon, overlaps } from './pickup-slots';

const TO = 'America/Toronto';
const at = (iso: string): Date => new Date(iso);

/** The documented default with targeted overrides. */
const sched = (over: Partial<OrgSchedule> = {}): OrgSchedule => ({ ...DEFAULT_PICKUP_SCHEDULE, ...over });

describe('pickup-slots (pure)', () => {
  describe('daySlots', () => {
    it('resolves the default windows to real Toronto instants (summer, EDT = UTC-4)', () => {
      const slots = daySlots('2026-07-10', TO, sched());
      expect(slots.map((s) => s.label)).toEqual(['Morning', 'Afternoon', 'Evening']);
      expect(slots[0]!.start.toISOString()).toBe('2026-07-10T13:00:00.000Z'); // 09:00 EDT
      expect(slots[0]!.end.toISOString()).toBe('2026-07-10T16:00:00.000Z'); // 12:00 EDT
      expect(slots[2]!.end.toISOString()).toBe('2026-07-10T22:00:00.000Z'); // 18:00 EDT
    });

    it('resolves the same wall clock to a different instant in winter (EST = UTC-5)', () => {
      const slots = daySlots('2026-01-15', TO, sched());
      expect(slots[0]!.start.toISOString()).toBe('2026-01-15T14:00:00.000Z'); // 09:00 EST
    });

    /** The customer is promised "9am". On the spring-forward day, 9am is an hour earlier in UTC. */
    it('is DST-correct on the spring-forward day', () => {
      expect(daySlots('2026-03-07', TO, sched())[0]!.start.toISOString()).toBe('2026-03-07T14:00:00.000Z');
      expect(daySlots('2026-03-08', TO, sched())[0]!.start.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    });

    it('sorts windows by start time regardless of the order they were saved in', () => {
      const s = sched({
        windows: [
          { label: 'Evening', start: '15:00', end: '18:00' },
          { label: 'Morning', start: '09:00', end: '12:00' },
        ],
      });
      expect(daySlots('2026-07-10', TO, s).map((x) => x.label)).toEqual(['Morning', 'Evening']);
    });

    it('a configured closed weekday has no slots at all', () => {
      // 2026-07-12 is a Sunday (0).
      expect(daySlots('2026-07-12', TO, sched({ closedDays: [0] }))).toEqual([]);
      expect(daySlots('2026-07-12', TO, sched({ closedDays: [6] }))).toHaveLength(3); // Saturday closed ≠ Sunday
    });

    it('throws on a nonexistent date rather than silently rolling it forward', () => {
      expect(() => daySlots('2026-02-30', TO, sched())).toThrow(/not a calendar date/);
    });
  });

  describe('clockReason', () => {
    const day = () => daySlots('2026-07-10', TO, sched());

    it('a window that has ended is `past`', () => {
      const morning = day()[0]!; // 13:00Z–16:00Z
      expect(clockReason(morning, at('2026-07-10T16:00:00Z'), 2)).toBe('past'); // exactly at the end
      expect(clockReason(morning, at('2026-07-10T18:00:00Z'), 2)).toBe('past');
    });

    /** Under way ≠ "we need more notice". Both are `past`: you cannot book ahead of a window that began. */
    it('a window that has STARTED but not ended is `past`, not `lead_time` — even with zero lead time', () => {
      const morning = day()[0]!; // 13:00Z–16:00Z
      expect(clockReason(morning, at('2026-07-10T14:30:00Z'), 0)).toBe('past');
      expect(clockReason(morning, at('2026-07-10T14:30:00Z'), 2)).toBe('past');
    });

    it('a window starting sooner than the lead time is `lead_time`', () => {
      const afternoon = day()[1]!; // starts 16:00Z
      expect(clockReason(afternoon, at('2026-07-10T14:30:00Z'), 2)).toBe('lead_time'); // 1.5h out
      expect(clockReason(afternoon, at('2026-07-10T14:00:00Z'), 2)).toBeNull(); // exactly 2h out → bookable
    });

    it('a lead time of zero makes a slot bookable until the instant it begins, then `past`', () => {
      const afternoon = day()[1]!; // starts 16:00Z
      expect(clockReason(afternoon, at('2026-07-10T15:59:59Z'), 0)).toBeNull();
      expect(clockReason(afternoon, at('2026-07-10T16:00:00Z'), 0)).toBe('past'); // the instant it begins
    });

    /** With no notice required, `lead_time` is unreachable: a future start is always bookable. */
    it('zero lead time never yields `lead_time`', () => {
      const afternoon = day()[1]!;
      expect(clockReason(afternoon, at('2026-07-10T15:59:59.999Z'), 0)).toBeNull();
    });

    it('honours a fractional lead time', () => {
      const afternoon = day()[1]!;
      expect(clockReason(afternoon, at('2026-07-10T15:29:00Z'), 0.5)).toBeNull();
      expect(clockReason(afternoon, at('2026-07-10T15:31:00Z'), 0.5)).toBe('lead_time');
    });

    it('a future day is always clock-bookable', () => {
      const tomorrowMorning = daySlots('2026-07-11', TO, sched())[0]!;
      expect(clockReason(tomorrowMorning, at('2026-07-10T18:00:00Z'), 2)).toBeNull();
    });
  });

  describe('bookableDates', () => {
    it('offers `horizonDays` days counting today as day 1', () => {
      // 2026-07-10 08:00Z = 04:00 EDT — the whole day is still ahead.
      const dates = bookableDates(at('2026-07-10T08:00:00Z'), TO, sched({ horizonDays: 7 }));
      expect(dates).toEqual([
        '2026-07-10',
        '2026-07-11',
        '2026-07-12',
        '2026-07-13',
        '2026-07-14',
        '2026-07-15',
        '2026-07-16',
      ]);
    });

    /** The bug a naive `new Date()` picker ships: after the last cut, today is gone but must not linger. */
    it('drops today once every window has passed the lead-time cut', () => {
      // 21:00Z = 17:00 EDT. Morning + Afternoon have ended; Evening (15:00–18:00 EDT) is under way → all past.
      const dates = bookableDates(at('2026-07-10T21:00:00Z'), TO, sched({ horizonDays: 3 }));
      expect(dates).toEqual(['2026-07-11', '2026-07-12']);
    });

    it('keeps today while one window is still far enough out', () => {
      // 18:00Z = 14:00 EDT → Evening starts 19:00Z, exactly 1h out. A 1h lead still qualifies it; 2h does not.
      expect(bookableDates(at('2026-07-10T18:00:00Z'), TO, sched({ horizonDays: 1, leadTimeHours: 1 }))).toEqual([
        '2026-07-10',
      ]);
      expect(bookableDates(at('2026-07-10T18:00:00Z'), TO, sched({ horizonDays: 1, leadTimeHours: 2 }))).toEqual([]);
    });

    it('omits closed weekdays from the strip', () => {
      // Sun 2026-07-12 + Sat 2026-07-11 closed.
      const dates = bookableDates(at('2026-07-10T08:00:00Z'), TO, sched({ horizonDays: 5, closedDays: [0, 6] }));
      expect(dates).toEqual(['2026-07-10', '2026-07-13', '2026-07-14']);
    });

    it('uses the BUSINESS day, not the UTC day', () => {
      // 2026-07-11 02:00Z is still Fri 2026-07-10 (22:00 EDT) in Toronto — the strip must start on the 10th.
      // Nothing on the 10th is bookable that late, so the first offered day is the 11th, and the horizon
      // is measured from the 10th.
      const dates = bookableDates(at('2026-07-11T02:00:00Z'), TO, sched({ horizonDays: 2 }));
      expect(dates).toEqual(['2026-07-11']);
    });

    it('an entirely closed horizon yields no days (and does not throw)', () => {
      const dates = bookableDates(at('2026-07-11T08:00:00Z'), TO, sched({ horizonDays: 2, closedDays: [0, 6] }));
      expect(dates).toEqual([]); // Sat 11th + Sun 12th
    });
  });

  describe('isWithinHorizon', () => {
    const now = at('2026-07-10T08:00:00Z'); // 04:00 EDT on the 10th

    it('accepts today through the last horizon day', () => {
      expect(isWithinHorizon('2026-07-10', now, TO, sched({ horizonDays: 7 }))).toBe(true);
      expect(isWithinHorizon('2026-07-16', now, TO, sched({ horizonDays: 7 }))).toBe(true);
    });

    it('rejects yesterday and the day past the horizon', () => {
      expect(isWithinHorizon('2026-07-09', now, TO, sched({ horizonDays: 7 }))).toBe(false);
      expect(isWithinHorizon('2026-07-17', now, TO, sched({ horizonDays: 7 }))).toBe(false);
    });

    it('a CLOSED day inside the horizon is in range (the endpoint answers `closed: true`)', () => {
      expect(isWithinHorizon('2026-07-12', now, TO, sched({ horizonDays: 7, closedDays: [0] }))).toBe(true);
    });

    it('rejects a nonexistent date', () => {
      expect(isWithinHorizon('2026-02-30', now, TO, sched())).toBe(false);
    });
  });

  describe('overlaps', () => {
    const d = (h: number) => new Date(Date.UTC(2026, 6, 10, h));

    it('adjacent windows do not overlap', () => {
      expect(overlaps(d(9), d(12), d(12), d(15))).toBe(false);
    });

    it('a partial straddle overlaps in both directions', () => {
      expect(overlaps(d(9), d(12), d(11), d(15))).toBe(true);
      expect(overlaps(d(11), d(15), d(9), d(12))).toBe(true);
    });

    it('containment overlaps', () => {
      expect(overlaps(d(9), d(18), d(12), d(13))).toBe(true);
      expect(overlaps(d(12), d(13), d(9), d(18))).toBe(true);
    });

    it('disjoint windows do not overlap', () => {
      expect(overlaps(d(9), d(10), d(11), d(12))).toBe(false);
    });
  });
});
