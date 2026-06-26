import { guardRate, guardStopsPerHour, MAX_PLAUSIBLE_STOPS_PER_HOUR } from './ratio';

describe('guardRate (display-side plausibility guard)', () => {
  it('passes a plausible rate through with no flag and no reason', () => {
    const g = guardRate(12.5, { max: 100, unit: 'stops/hr' });
    expect(g.plausible).toBe(true);
    expect(g.reason).toBe('');
    expect(g.raw).toBe(12.5);
  });

  it('flags an implausibly high rate as insufficient data — and DISCLOSES the raw figure (no cover-up)', () => {
    const g = guardRate(195652, { max: 100, unit: 'stops/hr' });
    expect(g.plausible).toBe(false);
    expect(g.reason).toMatch(/insufficient data/i);
    expect(g.reason).toMatch(/195,652/); // the absurd value is surfaced, not hidden behind a clean number
  });

  it('treats negative / non-finite values as insufficient data', () => {
    expect(guardRate(-1, { max: 100, unit: 'x' }).plausible).toBe(false);
    expect(guardRate(Infinity, { max: 100, unit: 'x' }).plausible).toBe(false);
    expect(guardRate(Number.NaN, { max: 100, unit: 'x' }).plausible).toBe(false);
  });

  it('accepts the boundary (== max) but not just above it', () => {
    expect(guardRate(100, { max: 100, unit: 'x' }).plausible).toBe(true);
    expect(guardRate(100.01, { max: 100, unit: 'x' }).plausible).toBe(false);
  });

  it('guardStopsPerHour uses the documented ceiling', () => {
    expect(MAX_PLAUSIBLE_STOPS_PER_HOUR).toBe(100);
    expect(guardStopsPerHour(5).plausible).toBe(true);
    expect(guardStopsPerHour(5000).plausible).toBe(false);
  });
});
