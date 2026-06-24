import { ServiceUnit } from '@blue-bee/shared';
import { deriveMeasure } from './quote.service';

describe('deriveMeasure (intake measurement → chargeable measure, PRD §8.3)', () => {
  it('SQFT uses sqft, falling back to widthFt × lengthFt', () => {
    expect(deriveMeasure(ServiceUnit.SQFT, { sqft: 40 })).toBe(40);
    expect(deriveMeasure(ServiceUnit.SQFT, { widthFt: 5, lengthFt: 8 })).toBe(40);
    expect(deriveMeasure(ServiceUnit.SQFT, {})).toBeNull();
    expect(deriveMeasure(ServiceUnit.SQFT, { widthFt: 5 })).toBeNull(); // incomplete dims
  });

  it('PIECE/ITEM use pieces|count|qty', () => {
    expect(deriveMeasure(ServiceUnit.PIECE, { pieces: 6 })).toBe(6);
    expect(deriveMeasure(ServiceUnit.ITEM, { count: 3 })).toBe(3);
    expect(deriveMeasure(ServiceUnit.PIECE, { qty: 2 })).toBe(2);
  });

  it('LB uses weightLb|lb|weight', () => {
    expect(deriveMeasure(ServiceUnit.LB, { weightLb: 12 })).toBe(12);
    expect(deriveMeasure(ServiceUnit.LB, { lb: 9 })).toBe(9);
  });

  it('rejects non-positive or non-numeric measures', () => {
    expect(deriveMeasure(ServiceUnit.SQFT, { sqft: 0 })).toBeNull();
    expect(deriveMeasure(ServiceUnit.SQFT, { sqft: -4 })).toBeNull();
    expect(deriveMeasure(ServiceUnit.PIECE, { pieces: 'lots' })).toBeNull();
  });
});
