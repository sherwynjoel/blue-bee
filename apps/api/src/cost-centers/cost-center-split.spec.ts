import { buildCostCenterBreakdown, parseStoredBreakdown, UNASSIGNED, type SplitLine } from './cost-center-split';
import { moneyToCents } from '../orders/money';

/**
 * Money-correctness lens (unit): the cost-centre split must RECONCILE EXACTLY to the invoice totals —
 * no rounding leak — and honour the "Unassigned" bucket honestly. Pure, cents-checked.
 */
describe('buildCostCenterBreakdown (cost-centre split math)', () => {
  const meta = new Map([
    ['cc-a', { code: 'TWR-A', name: 'Tower A' }],
    ['cc-b', { code: 'TWR-B', name: 'Tower B' }],
    ['cc-amen', { code: 'AMEN', name: 'Amenity' }],
  ]);

  // Deliberately awkward cents (e.g. 50.05/6.51, 75.25/9.78) so an off-by-a-cent split would show up.
  const lines: SplitLine[] = [
    { costCenterId: 'cc-a', subtotalCents: 10000, taxCents: 1300, totalCents: 11300 }, // 100.00 / 13.00 / 113.00
    { costCenterId: 'cc-a', subtotalCents: 5005, taxCents: 651, totalCents: 5656 }, // 50.05 / 6.51 / 56.56
    { costCenterId: 'cc-b', subtotalCents: 20000, taxCents: 2600, totalCents: 22600 }, // 200.00 / 26.00 / 226.00
    { costCenterId: 'cc-amen', subtotalCents: 7525, taxCents: 978, totalCents: 8503 }, // 75.25 / 9.78 / 85.03
    { costCenterId: null, subtotalCents: 4040, taxCents: 525, totalCents: 4565 }, // 40.40 / 5.25 / 45.65 (Unassigned)
  ];

  const sumCents = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('splits exactly reconcile to the invoice subtotal/tax/total (cents-exact, no leak)', () => {
    const breakdown = buildCostCenterBreakdown(lines, meta);
    const invSubtotal = sumCents(lines.map((l) => l.subtotalCents));
    const invTax = sumCents(lines.map((l) => l.taxCents));
    const invTotal = sumCents(lines.map((l) => l.totalCents));

    expect(sumCents(breakdown.map((e) => moneyToCents(e.subtotal)))).toBe(invSubtotal);
    expect(sumCents(breakdown.map((e) => moneyToCents(e.tax)))).toBe(invTax);
    expect(sumCents(breakdown.map((e) => moneyToCents(e.total)))).toBe(invTotal);
    // subtotal + tax == total holds for every bucket and for the whole invoice.
    for (const e of breakdown) expect(moneyToCents(e.subtotal) + moneyToCents(e.tax)).toBe(moneyToCents(e.total));
  });

  it('groups per cost centre with correct per-bucket amounts', () => {
    const breakdown = buildCostCenterBreakdown(lines, meta);
    const byId = new Map(breakdown.map((e) => [e.costCenterId, e]));
    expect(byId.get('cc-a')).toMatchObject({ code: 'TWR-A', name: 'Tower A', subtotal: '150.05', tax: '19.51', total: '169.56' });
    expect(byId.get('cc-b')).toMatchObject({ code: 'TWR-B', subtotal: '200.00', tax: '26.00', total: '226.00' });
    expect(byId.get('cc-amen')).toMatchObject({ code: 'AMEN', subtotal: '75.25', tax: '9.78', total: '85.03' });
  });

  it('puts the no-cost-centre lines in an explicit Unassigned bucket, always LAST', () => {
    const breakdown = buildCostCenterBreakdown(lines, meta);
    const unassigned = breakdown.find((e) => e.costCenterId === null);
    expect(unassigned).toMatchObject({ code: UNASSIGNED.code, name: UNASSIGNED.name, subtotal: '40.40', tax: '5.25', total: '45.65' });
    expect(breakdown[breakdown.length - 1].costCenterId).toBeNull();
  });

  it('orders named centres by code ascending (deterministic → stable on re-run)', () => {
    const codes = buildCostCenterBreakdown(lines, meta).map((e) => e.code);
    expect(codes).toEqual(['AMEN', 'TWR-A', 'TWR-B', UNASSIGNED.code]);
  });

  it('all-assigned produces no Unassigned bucket', () => {
    const assigned = lines.filter((l) => l.costCenterId !== null);
    const breakdown = buildCostCenterBreakdown(assigned, meta);
    expect(breakdown.some((e) => e.costCenterId === null)).toBe(false);
  });

  it('all-unassigned collapses to a single Unassigned bucket', () => {
    const onlyNull: SplitLine[] = [
      { costCenterId: null, subtotalCents: 1000, taxCents: 130, totalCents: 1130 },
      { costCenterId: null, subtotalCents: 999, taxCents: 130, totalCents: 1129 },
    ];
    const breakdown = buildCostCenterBreakdown(onlyNull, new Map());
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toMatchObject({ costCenterId: null, subtotal: '19.99', tax: '2.60', total: '22.59' });
  });

  it('falls back to an id-prefix code when meta is missing (defensive — unreachable in practice)', () => {
    const breakdown = buildCostCenterBreakdown([{ costCenterId: 'deadbeef-1234', subtotalCents: 100, taxCents: 0, totalCents: 100 }], new Map());
    expect(breakdown[0].code).toBe('DEADBEEF');
  });
});

describe('parseStoredBreakdown (invoice read normalization)', () => {
  it('returns [] for the default empty-object column (un-split invoice)', () => {
    expect(parseStoredBreakdown({})).toEqual([]);
    expect(parseStoredBreakdown(null)).toEqual([]);
    expect(parseStoredBreakdown(undefined)).toEqual([]);
  });

  it('passes a stored array through as typed entries', () => {
    const stored = [{ costCenterId: 'cc-a', code: 'TWR-A', name: 'Tower A', subtotal: '150.05', tax: '19.51', total: '169.56' }];
    expect(parseStoredBreakdown(stored)).toEqual(stored);
  });
});
