import { ServiceUnit } from '@blue-bee/shared';
import { computePackToParLines, totalGap, type ParInput, type StockInput } from './pack-to-par';

/**
 * Pack-to-par load-sheet math (PRD §B3.2) — the QC quantity-correctness lens as a pure unit test:
 * gap = max(0, par − on-hand) EXACTLY (never negative / over-pack), on-hand keyed identically to par so a
 * site-level (NULL cost-centre) par never bleeds into a wing's gap, and on-hand with no par is ignored.
 */
const par = (over: Partial<ParInput> & { serviceId: string; targetQty: number }): ParInput => ({
  costCenterId: null,
  sku: over.sku ?? over.serviceId,
  unit: ServiceUnit.PIECE,
  ...over,
});
const stock = (serviceId: string, onHand: number, costCenterId: string | null = null): StockInput => ({ serviceId, costCenterId, onHand });

describe('computePackToParLines', () => {
  it('gap = max(0, par − onHand): below par packs the shortfall', () => {
    const lines = computePackToParLines([par({ serviceId: 'sheet', sku: 'Sheets', targetQty: 100 })], [stock('sheet', 60)]);
    expect(lines).toEqual([{ serviceId: 'sheet', sku: 'Sheets', unit: ServiceUnit.PIECE, costCenterId: null, par: 100, onHand: 60, gap: 40 }]);
  });

  it('at/over par ⇒ gap 0 (never negative, never over-packs)', () => {
    const lines = computePackToParLines(
      [par({ serviceId: 'a', targetQty: 50 }), par({ serviceId: 'b', targetQty: 30 })],
      [stock('a', 50), stock('b', 80)],
    );
    expect(lines.map((l) => l.gap)).toEqual([0, 0]);
  });

  it('a par with no on-hand row ⇒ onHand 0, gap = full par', () => {
    const lines = computePackToParLines([par({ serviceId: 'towel', targetQty: 24 })], []);
    expect(lines[0]).toMatchObject({ onHand: 0, gap: 24 });
  });

  it('on-hand with no matching par is ignored (the sheet is par-driven)', () => {
    const lines = computePackToParLines([par({ serviceId: 'sheet', targetQty: 10 })], [stock('sheet', 4), stock('blanket', 999)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].serviceId).toBe('sheet');
  });

  it('cost-centre split: a wing par draws ONLY its wing on-hand — a site-level (NULL) par never bleeds in', () => {
    const lines = computePackToParLines(
      [
        par({ serviceId: 'sheet', targetQty: 40, costCenterId: 'west', sku: 'Sheets' }),
        par({ serviceId: 'sheet', targetQty: 30, costCenterId: null, sku: 'Sheets' }),
      ],
      [stock('sheet', 10, 'west'), stock('sheet', 25, null)],
    );
    const west = lines.find((l) => l.costCenterId === 'west')!;
    const siteLevel = lines.find((l) => l.costCenterId === null)!;
    expect(west.gap).toBe(30); // 40 − 10 (wing on-hand only)
    expect(siteLevel.gap).toBe(5); // 30 − 25 (site-level on-hand only)
  });

  it('filters to a single cost-centre when asked', () => {
    const lines = computePackToParLines(
      [par({ serviceId: 'sheet', targetQty: 40, costCenterId: 'west' }), par({ serviceId: 'sheet', targetQty: 30, costCenterId: 'east' })],
      [stock('sheet', 10, 'west'), stock('sheet', 5, 'east')],
      'west',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ costCenterId: 'west', gap: 30 });
  });

  it('negative on-hand (over-picked) still yields a non-negative gap', () => {
    const lines = computePackToParLines([par({ serviceId: 'sheet', targetQty: 20 })], [stock('sheet', -5)]);
    expect(lines[0].gap).toBe(25); // 20 − (−5)
  });

  it('orders by cost-centre (site-level NULL last) then SKU', () => {
    const lines = computePackToParLines(
      [
        par({ serviceId: 's2', sku: 'Towels', targetQty: 1, costCenterId: null }),
        par({ serviceId: 's1', sku: 'Sheets', targetQty: 1, costCenterId: 'west' }),
        par({ serviceId: 's3', sku: 'Gowns', targetQty: 1, costCenterId: 'west' }),
      ],
      [],
    );
    expect(lines.map((l) => [l.costCenterId, l.sku])).toEqual([
      ['west', 'Gowns'],
      ['west', 'Sheets'],
      [null, 'Towels'],
    ]);
  });

  it('totalGap sums the shortfalls', () => {
    const lines = computePackToParLines(
      [par({ serviceId: 'a', targetQty: 10 }), par({ serviceId: 'b', targetQty: 20 })],
      [stock('a', 3), stock('b', 20)],
    );
    expect(totalGap(lines)).toBe(7); // 7 + 0
  });
});
