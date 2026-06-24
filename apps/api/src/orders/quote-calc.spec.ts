import { computeQuote, QuoteCalcError, type QuoteLineInput } from './quote-calc';

const line = (over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  itemId: 'item-1',
  serviceId: 'svc-1',
  serviceName: 'Area rug hand-wash (wool)',
  unit: 'SQFT',
  measure: 40,
  rate: 6.5,
  rateSource: 'default_list',
  upcharges: [],
  ...over,
});

describe('computeQuote (PRD §8.3 quote engine)', () => {
  it('computes subtotal, 13% HST, total for a single line (matches the seed demo)', () => {
    const q = computeQuote([line()], 0.13);
    expect(q.lines[0].amount).toBe('260.00');
    expect(q.subtotal).toBe('260.00');
    expect(q.tax).toBe('33.80');
    expect(q.total).toBe('293.80');
  });

  it('applies a per-account override rate (5.00 vs base 6.50)', () => {
    const q = computeQuote([line({ rate: 5.0, rateSource: 'account_override' })], 0.13);
    expect(q.subtotal).toBe('200.00');
    expect(q.tax).toBe('26.00');
    expect(q.total).toBe('226.00');
    expect(q.lines[0].rateSource).toBe('account_override');
  });

  it('adds upcharges on top of measure × rate', () => {
    const q = computeQuote([line({ upcharges: [{ code: 'PET', label: 'Pet treatment', amount: 25 }] })], 0.13);
    expect(q.lines[0].baseAmount).toBe('260.00');
    expect(q.lines[0].upchargeTotal).toBe('25.00');
    expect(q.lines[0].amount).toBe('285.00');
    expect(q.subtotal).toBe('285.00');
    expect(q.tax).toBe('37.05');
    expect(q.total).toBe('322.05');
  });

  it('persists a manual adjustment with before/after (audited)', () => {
    const q = computeQuote([line()], 0.13, { reason: 'loyalty discount', amount: -50, actorId: 'actor-1' });
    expect(q.subtotalBeforeAdjustment).toBe('260.00');
    expect(q.adjustment).toMatchObject({ reason: 'loyalty discount', actorId: 'actor-1', before: '260.00', after: '210.00', amount: '-50.00' });
    expect(q.subtotal).toBe('210.00');
    expect(q.tax).toBe('27.30');
    expect(q.total).toBe('237.30');
  });

  it('sums and rounds multiple lines correctly', () => {
    const q = computeQuote([line({ itemId: 'a', measure: 12.5 }), line({ itemId: 'b', measure: 33, rate: 4.25 })], 0.13);
    // 12.5×6.5=81.25 ; 33×4.25=140.25 ; subtotal 221.50 ; tax 28.795→28.80 ; total 250.30
    expect(q.lines[0].amount).toBe('81.25');
    expect(q.lines[1].amount).toBe('140.25');
    expect(q.subtotal).toBe('221.50');
    expect(q.tax).toBe('28.80');
    expect(q.total).toBe('250.30');
  });

  it('rejects non-positive / non-finite measures', () => {
    expect(() => computeQuote([line({ measure: 0 })], 0.13)).toThrow(QuoteCalcError);
    expect(() => computeQuote([line({ measure: -5 })], 0.13)).toThrow(QuoteCalcError);
    expect(() => computeQuote([line({ measure: Number.NaN })], 0.13)).toThrow(QuoteCalcError);
  });

  it('rejects an adjustment that drives the subtotal below zero', () => {
    expect(() => computeQuote([line()], 0.13, { reason: 'too much', amount: -1000, actorId: 'a' })).toThrow(QuoteCalcError);
  });

  it('rejects an out-of-range tax rate', () => {
    expect(() => computeQuote([line()], 1.5)).toThrow(QuoteCalcError);
  });

  it('handles a very large (oversized) measure without overflow', () => {
    const q = computeQuote([line({ measure: 100000, rate: 6.5 })], 0.13);
    expect(q.subtotal).toBe('650000.00');
    expect(q.total).toBe('734500.00');
  });
});
