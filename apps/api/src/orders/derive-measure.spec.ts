import { LB_PER_KG, PricingUnit, ServiceUnit, backingServiceUnit, kgToLb } from '@blue-bee/shared';
import { deriveMeasure } from './quote.service';
import { computeQuote, type QuoteLineInput } from './quote-calc';

/**
 * [Inc-24] Per-pound pricing. Weight is CAPTURED canonically in kilograms (WeightCapture.weightKg,
 * denormalized onto Item.measurements.weightKg by the WeighService). A PER_LB card backs a `Service` with
 * `ServiceUnit.LB`, so the chargeable measure must be POUNDS — converted once, in deriveMeasure.
 */
const line = (over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  itemId: 'item-1',
  serviceId: 'svc-1',
  serviceName: 'Wash & Fold',
  unit: 'LB',
  measure: 1,
  rate: 1,
  rateSource: 'service_base',
  upcharges: [],
  ...over,
});

describe('[Inc-24] kg → lb conversion lives in exactly one place', () => {
  it('LB_PER_KG is the exact factor and kgToLb applies it', () => {
    expect(LB_PER_KG).toBe(2.2046226218);
    expect(kgToLb(6)).toBeCloseTo(13.2277357308, 10);
    expect(kgToLb(0)).toBe(0);
  });

  it('a PER_LB card backs an LB service (PER_KG still backs KG, PER_ITEM → ITEM, PER_MEASURE → SQFT)', () => {
    expect(backingServiceUnit(PricingUnit.PER_LB)).toBe(ServiceUnit.LB);
    expect(backingServiceUnit(PricingUnit.PER_KG)).toBe(ServiceUnit.KG);
    expect(backingServiceUnit(PricingUnit.PER_ITEM)).toBe(ServiceUnit.ITEM);
    expect(backingServiceUnit(PricingUnit.PER_MEASURE)).toBe(ServiceUnit.SQFT);
  });
});

describe('[Inc-24] deriveMeasure — LB reads the canonical kg capture', () => {
  it('converts the kg weigh capture into pounds for an LB service', () => {
    expect(deriveMeasure(ServiceUnit.LB, { weightKg: 6 })).toBeCloseTo(13.2277357308, 10);
    expect(deriveMeasure(ServiceUnit.LB, { kg: 6 })).toBeCloseTo(13.2277357308, 10);
  });

  it('an EXPLICIT pound measurement still wins over the kg capture (back-compat with LB linen lines)', () => {
    expect(deriveMeasure(ServiceUnit.LB, { weightLb: 10 })).toBe(10);
    expect(deriveMeasure(ServiceUnit.LB, { lb: 10 })).toBe(10);
    expect(deriveMeasure(ServiceUnit.LB, { weightLb: 10, weightKg: 6 })).toBe(10);
  });

  it('the kg capture is preferred over the AMBIGUOUS `weight` key (a kg load is never read as pounds)', () => {
    expect(deriveMeasure(ServiceUnit.LB, { weightKg: 6, weight: 6 })).toBeCloseTo(13.2277357308, 10);
    // with no kg capture at all, the legacy ambiguous key is still honoured as pounds
    expect(deriveMeasure(ServiceUnit.LB, { weight: 10 })).toBe(10);
  });

  it('returns null when an LB line has no usable measurement (no invented weight)', () => {
    expect(deriveMeasure(ServiceUnit.LB, {})).toBeNull();
    expect(deriveMeasure(ServiceUnit.LB, { weightKg: 0 })).toBeNull();
  });

  it('leaves the existing per-kg / per-item / per-sqft derivations untouched', () => {
    expect(deriveMeasure(ServiceUnit.KG, { weightKg: 6 })).toBe(6);
    expect(deriveMeasure(ServiceUnit.ITEM, { pieces: 3 })).toBe(3);
    expect(deriveMeasure(ServiceUnit.PIECE, { count: 4 })).toBe(4);
    expect(deriveMeasure(ServiceUnit.SQFT, { widthFt: 5, lengthFt: 8 })).toBe(40);
  });
});

describe('[Inc-24] per-lb price = (kg × LB_PER_KG) × rate', () => {
  it('prices a 6.00 kg load at $1.50 / lb → 13.2277… lb → $19.84', () => {
    const measure = deriveMeasure(ServiceUnit.LB, { weightKg: 6 });
    expect(measure).not.toBeNull();
    const q = computeQuote([line({ unit: 'LB', measure: measure as number, rate: 1.5 })], 0.13);
    expect(q.lines[0]?.amount).toBe('19.84'); // 13.2277357308 × 1.50 = 19.8416… → 1984 cents
    expect(q.subtotal).toBe('19.84');
  });

  it('the existing per-kg price is unaffected: 6.00 kg × $3.50 / kg → $21.00', () => {
    const measure = deriveMeasure(ServiceUnit.KG, { weightKg: 6 });
    const q = computeQuote([line({ unit: 'KG', measure: measure as number, rate: 3.5 })], 0.13);
    expect(q.lines[0]?.amount).toBe('21.00');
  });

  it('the existing per-item price is unaffected: 3 items × $6.00 → $18.00', () => {
    const measure = deriveMeasure(ServiceUnit.ITEM, { pieces: 3 });
    const q = computeQuote([line({ unit: 'ITEM', measure: measure as number, rate: 6 })], 0.13);
    expect(q.lines[0]?.amount).toBe('18.00');
  });
});
