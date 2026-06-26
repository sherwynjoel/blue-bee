import { formatNumber, money } from './format';

describe('formatNumber (thousands separators)', () => {
  it('groups large integers', () => {
    expect(formatNumber(195652)).toBe('195,652');
    expect(formatNumber(343)).toBe('343');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('keeps small decimals readable (≤2 places, trailing zeros trimmed)', () => {
    expect(formatNumber(0.69)).toBe('0.69');
    expect(formatNumber(4)).toBe('4');
    expect(formatNumber(3.5)).toBe('3.5');
  });

  it('renders an honest em-dash for non-finite / nullish input', () => {
    expect(formatNumber(Infinity)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
  });
});

describe('money (grouped integer part, decimals preserved verbatim)', () => {
  it('groups the integer part and keeps the decimals + currency', () => {
    expect(money('24498.40')).toBe('$24,498.40 CAD');
    expect(money('1000.00')).toBe('$1,000.00 CAD');
    expect(money('293.80')).toBe('$293.80 CAD');
  });

  it('handles a custom/blank currency and a negative amount', () => {
    expect(money('1234.50', '')).toBe('$1,234.50');
    expect(money('-1500.00')).toBe('$-1,500.00 CAD');
  });

  it('renders an em-dash for nullish/empty amounts', () => {
    expect(money(null)).toBe('—');
    expect(money('')).toBe('—');
  });
});
