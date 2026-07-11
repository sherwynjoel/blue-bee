import { dateKeyParts, hhmmTo12h, windowText } from './format';

/**
 * [Inc-28] The pickup-scheduling formatters. They exist to keep `Intl`/`toLocale*` out of the pickup UI:
 * a window is the ORG's wall clock, not the device's, and Hermes' partial `Intl` cannot be trusted with a
 * `timeZone` on Android. These are pure string/index math and must render identically everywhere.
 */
describe('format — pickup scheduling (Inc-28)', () => {
  describe('hhmmTo12h', () => {
    it.each([
      ['00:00', '12:00 AM'],
      ['00:30', '12:30 AM'],
      ['09:00', '9:00 AM'],
      ['11:59', '11:59 AM'],
      ['12:00', '12:00 PM'],
      ['12:45', '12:45 PM'],
      ['13:00', '1:00 PM'],
      ['15:00', '3:00 PM'],
      ['18:00', '6:00 PM'],
      ['23:59', '11:59 PM'],
    ])('%s → %s', (input, expected) => {
      expect(hhmmTo12h(input)).toBe(expected);
    });

    it('returns a malformed value unchanged rather than rendering nonsense', () => {
      expect(hhmmTo12h('9:00')).toBe('9:00');
      expect(hhmmTo12h('')).toBe('');
      expect(hhmmTo12h('not-a-time')).toBe('not-a-time');
    });
  });

  describe('windowText', () => {
    it('renders the founder\'s wall clock, not the device\'s', () => {
      expect(windowText('09:00', '12:00')).toBe('9:00 AM – 12:00 PM');
      expect(windowText('15:00', '18:00')).toBe('3:00 PM – 6:00 PM');
    });
  });

  describe('dateKeyParts', () => {
    it('reads the calendar date as written (2026-07-11 is a Saturday)', () => {
      expect(dateKeyParts('2026-07-11')).toEqual({ weekday: 'Sat', day: '11', month: 'Jul' });
      expect(dateKeyParts('2026-07-12')).toEqual({ weekday: 'Sun', day: '12', month: 'Jul' });
      expect(dateKeyParts('2026-01-01')).toEqual({ weekday: 'Thu', day: '1', month: 'Jan' });
      expect(dateKeyParts('2026-12-31')).toEqual({ weekday: 'Thu', day: '31', month: 'Dec' });
    });

    /**
     * The bug this guards, made explicit. `'2026-07-11'` parses to UTC midnight; reading it back with the
     * LOCAL accessors (`getDate()`/`getDay()`) on a phone west of Greenwich yields the 10th — a day chip
     * labelled a day early, for exactly the customers most likely to be travelling. `dateKeyParts` reads it
     * back with `getUTCDate()`/`getUTCDay()`, so it agrees with the string it was handed on every device.
     *
     * The assertion below compares against the local reading rather than stubbing a timezone: whenever the
     * test runner is west of UTC the two genuinely differ, and `dateKeyParts` must track the string.
     */
    it('reads the key with UTC accessors, so a west-of-UTC device cannot slip it a day', () => {
      const key = '2026-07-11';
      const asDate = new Date(`${key}T00:00:00Z`);
      expect(dateKeyParts(key).day).toBe(String(asDate.getUTCDate()));
      expect(dateKeyParts(key).day).toBe('11'); // …and that is the day the SERVER named.
      // When the runner sits west of UTC, the naive local read really is a different day. We never use it.
      if (asDate.getTimezoneOffset() > 0) expect(String(asDate.getDate())).not.toBe(dateKeyParts(key).day);
    });

    it('degrades to an em dash on a malformed key rather than crashing the picker', () => {
      expect(dateKeyParts('nonsense')).toEqual({ weekday: '—', day: '—', month: '' });
    });
  });
});
