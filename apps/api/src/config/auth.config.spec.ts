import { parseDurationSeconds } from './auth.config';

describe('parseDurationSeconds', () => {
  it('parses suffixed durations', () => {
    expect(parseDurationSeconds('15m', 0)).toBe(900);
    expect(parseDurationSeconds('30d', 0)).toBe(2592000);
    expect(parseDurationSeconds('2h', 0)).toBe(7200);
    expect(parseDurationSeconds('45s', 0)).toBe(45);
  });

  it('parses bare numbers as seconds', () => {
    expect(parseDurationSeconds('900', 0)).toBe(900);
  });

  it('falls back on garbage', () => {
    expect(parseDurationSeconds('nonsense', 123)).toBe(123);
    expect(parseDurationSeconds('', 7)).toBe(7);
  });
});
