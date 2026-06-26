import { StandingOrderCadence } from '@blue-bee/shared';
import {
  buildPickupWindowForDate,
  firstWeekdayOnOrAfter,
  matchesCadence,
  nextOccurrenceAfter,
  occurrenceDatesInWindow,
  periodKey,
  utcDateFloor,
  wholeDaysBetween,
  type CadenceSpec,
} from './recurring-schedule';

const d = (iso: string): Date => new Date(iso);
// 2026-03-02 is a Monday (getUTCDay()===1). The US spring-forward DST change is Sun 2026-03-08 —
// it sits BETWEEN the Mar-02 and Mar-09 Mondays, so these fixtures prove DST can't shift cadence.
const MON = 1;

describe('recurring-schedule (pure cadence math)', () => {
  it('utcDateFloor / periodKey strip time-of-day to the UTC calendar date', () => {
    expect(periodKey(d('2026-03-02T13:45:00Z'))).toBe('2026-03-02');
    expect(utcDateFloor(d('2026-03-02T23:59:59Z')).toISOString()).toBe('2026-03-02T00:00:00.000Z');
  });

  it('2026-03-02 is a Monday (fixture sanity)', () => {
    expect(utcDateFloor(d('2026-03-02')).getUTCDay()).toBe(MON);
  });

  it('wholeDaysBetween is integer days regardless of time-of-day (DST-safe)', () => {
    // Mar 2 → Mar 9 spans the spring-forward; still exactly 7 whole days.
    expect(wholeDaysBetween(d('2026-03-02T06:00:00Z'), d('2026-03-09T20:00:00Z'))).toBe(7);
  });

  it('firstWeekdayOnOrAfter returns the date itself when already on the weekday', () => {
    expect(periodKey(firstWeekdayOnOrAfter(d('2026-03-02'), MON))).toBe('2026-03-02');
    expect(periodKey(firstWeekdayOnOrAfter(d('2026-03-03'), MON))).toBe('2026-03-09');
  });

  describe('matchesCadence', () => {
    const weekly: CadenceSpec = { cadence: StandingOrderCadence.WEEKLY, weekday: MON, startsOn: d('2026-03-02') };
    const biweekly: CadenceSpec = { cadence: StandingOrderCadence.BIWEEKLY, weekday: MON, startsOn: d('2026-03-02') };

    it('weekly matches every Monday on/after startsOn, never another weekday', () => {
      expect(matchesCadence(weekly, d('2026-03-02'))).toBe(true);
      expect(matchesCadence(weekly, d('2026-03-09'))).toBe(true); // the Monday right after the DST change
      expect(matchesCadence(weekly, d('2026-03-16'))).toBe(true);
      expect(matchesCadence(weekly, d('2026-03-03'))).toBe(false); // Tuesday
      expect(matchesCadence(weekly, d('2026-02-23'))).toBe(false); // before startsOn
    });

    it('biweekly matches even-week Mondays from the anchor, skips odd weeks — unaffected by DST', () => {
      expect(matchesCadence(biweekly, d('2026-03-02'))).toBe(true); // anchor (week 0)
      expect(matchesCadence(biweekly, d('2026-03-09'))).toBe(false); // week 1 (just after DST) — skipped
      expect(matchesCadence(biweekly, d('2026-03-16'))).toBe(true); // week 2
      expect(matchesCadence(biweekly, d('2026-03-23'))).toBe(false); // week 3
      expect(matchesCadence(biweekly, d('2026-03-30'))).toBe(true); // week 4
    });
  });

  describe('occurrenceDatesInWindow', () => {
    it('weekly: every Monday in the window, clamped to startsOn', () => {
      const spec: CadenceSpec = { cadence: StandingOrderCadence.WEEKLY, weekday: MON, startsOn: d('2026-03-02') };
      const got = occurrenceDatesInWindow(spec, d('2026-02-20'), d('2026-03-31')).map(periodKey);
      expect(got).toEqual(['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
    });

    it('biweekly: every other Monday across the DST boundary (parity preserved)', () => {
      const spec: CadenceSpec = { cadence: StandingOrderCadence.BIWEEKLY, weekday: MON, startsOn: d('2026-03-02') };
      const got = occurrenceDatesInWindow(spec, d('2026-03-01'), d('2026-03-31')).map(periodKey);
      expect(got).toEqual(['2026-03-02', '2026-03-16', '2026-03-30']);
    });

    it('respects endsOn (inclusive) and returns [] when the window precedes startsOn', () => {
      const spec: CadenceSpec = {
        cadence: StandingOrderCadence.WEEKLY,
        weekday: MON,
        startsOn: d('2026-03-02'),
        endsOn: d('2026-03-16'),
      };
      expect(occurrenceDatesInWindow(spec, d('2026-03-01'), d('2026-03-31')).map(periodKey)).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
      ]);
      expect(occurrenceDatesInWindow(spec, d('2026-01-01'), d('2026-02-01'))).toEqual([]);
    });
  });

  describe('nextOccurrenceAfter', () => {
    const weekly: CadenceSpec = { cadence: StandingOrderCadence.WEEKLY, weekday: MON, startsOn: d('2026-03-02') };
    const biweekly: CadenceSpec = { cadence: StandingOrderCadence.BIWEEKLY, weekday: MON, startsOn: d('2026-03-02') };

    it('weekly: strictly after the given date', () => {
      expect(periodKey(nextOccurrenceAfter(weekly, d('2026-03-02'))!)).toBe('2026-03-09');
      expect(periodKey(nextOccurrenceAfter(weekly, d('2026-03-05'))!)).toBe('2026-03-09');
    });

    it('biweekly: skips the odd week', () => {
      expect(periodKey(nextOccurrenceAfter(biweekly, d('2026-03-02'))!)).toBe('2026-03-16');
    });

    it('returns null past endsOn', () => {
      const spec: CadenceSpec = { ...weekly, endsOn: d('2026-03-09') };
      expect(nextOccurrenceAfter(spec, d('2026-03-09'))).toBeNull();
    });
  });

  it('buildPickupWindowForDate applies HH:MM as UTC wall-clock on the occurrence date', () => {
    const w = buildPickupWindowForDate(d('2026-03-02'), { start: '07:00', end: '09:30' });
    expect(w.start).toBe('2026-03-02T07:00:00.000Z');
    expect(w.end).toBe('2026-03-02T09:30:00.000Z');
  });
});
