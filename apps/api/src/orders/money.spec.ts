import { centsToMoney, roundCents, toMoney } from './money';

describe('money (quote arithmetic, PRD §8.3)', () => {
  it('rounds dollars to whole cents, half away from zero', () => {
    expect(roundCents(260)).toBe(26000);
    expect(roundCents(33.8)).toBe(3380);
    expect(roundCents(81.25)).toBe(8125);
    expect(roundCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004 → 30
    expect(roundCents(1.005)).toBe(101); // fp-safe half-up
    expect(roundCents(2.675)).toBe(268); // classic fp case → 267.499… nudged to 268
  });

  it('handles negative amounts (discounts) symmetrically', () => {
    expect(roundCents(-50)).toBe(-5000);
    expect(roundCents(-0.005)).toBe(-1);
  });

  it('throws on non-finite input', () => {
    expect(() => roundCents(Number.NaN)).toThrow();
    expect(() => roundCents(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('renders cents as fixed-2 money strings', () => {
    expect(centsToMoney(26000)).toBe('260.00');
    expect(centsToMoney(3380)).toBe('33.80');
    expect(centsToMoney(5)).toBe('0.05');
    expect(centsToMoney(0)).toBe('0.00');
    expect(centsToMoney(-5000)).toBe('-50.00');
  });

  it('toMoney composes round + render', () => {
    expect(toMoney(293.8)).toBe('293.80');
    expect(toMoney(226)).toBe('226.00');
  });
});
