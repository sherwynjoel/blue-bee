import { NearestNeighbourOptimizer, type DistanceLookup, type OptimizerStop } from './optimizer';

const opt = new NearestNeighbourOptimizer();

// A 1-D layout on the x-axis; distance = |x difference|.
const X: Record<string, number> = { DEPOT: 0, a: 1, c: 2, b: 3, far: 10 };
const dist: DistanceLookup = (f, t) => Math.abs(X[f] - X[t]);

const stop = (id: string, index: number, over: Partial<OptimizerStop> = {}): OptimizerStop => ({
  id,
  hasCoord: true,
  windowStartMs: null,
  index,
  ...over,
});

describe('NearestNeighbourOptimizer (PRD §6.2/§6.3 sequencing)', () => {
  it('orders by nearest distance from the depot', () => {
    // input order b(3), a(1), c(2); from DEPOT(0) → a, c, b
    const order = opt.sequence({ stops: [stop('b', 0), stop('a', 1), stop('c', 2)], hasDepot: true, distance: dist });
    expect(order).toEqual(['a', 'c', 'b']);
  });

  it('respects time windows ahead of distance (earliest window first)', () => {
    // `far` is far away but has the earliest window → must be visited first
    const order = opt.sequence({
      stops: [stop('a', 0, { windowStartMs: 2000 }), stop('far', 1, { windowStartMs: 1000 }), stop('c', 2, { windowStartMs: 3000 })],
      hasDepot: true,
      distance: dist,
    });
    expect(order).toEqual(['far', 'a', 'c']);
  });

  it('mixes windowed (first, by window) then window-free (by nearest)', () => {
    const order = opt.sequence({
      stops: [stop('b', 0), stop('far', 1, { windowStartMs: 1000 }), stop('a', 2)],
      hasDepot: true,
      distance: dist,
    });
    // far has a window → first; then from far(10): nearest of {a(1),b(3)} is b(3), then a
    expect(order[0]).toBe('far');
    expect(order.slice(1)).toEqual(['b', 'a']);
  });

  it('handles 0 and 1 stops', () => {
    expect(opt.sequence({ stops: [], hasDepot: true, distance: dist })).toEqual([]);
    expect(opt.sequence({ stops: [stop('a', 0)], hasDepot: true, distance: dist })).toEqual(['a']);
  });

  it('without a depot, starts from the lowest-index stop then nearest-neighbours', () => {
    // no depot → first pick is lowest index (b, index 0), then NN from b(3): c(2) then a(1)
    const order = opt.sequence({ stops: [stop('b', 0), stop('a', 1), stop('c', 2)], hasDepot: false, distance: dist });
    expect(order).toEqual(['b', 'c', 'a']);
  });

  it('appends coordinate-less stops last, in input order', () => {
    const order = opt.sequence({
      stops: [stop('a', 0), stop('nocoord1', 1, { hasCoord: false }), stop('b', 2), stop('nocoord0', 3, { hasCoord: false })],
      hasDepot: true,
      distance: dist,
    });
    // a,b sequenced by distance; nocoords appended in input order
    expect(order.slice(0, 2)).toEqual(['a', 'b']);
    expect(order.slice(2)).toEqual(['nocoord1', 'nocoord0']);
  });

  it('is deterministic for equal distances (stable index tiebreak)', () => {
    const eq: DistanceLookup = () => 5;
    const order = opt.sequence({ stops: [stop('z', 0), stop('y', 1), stop('x', 2)], hasDepot: true, distance: eq });
    expect(order).toEqual(['z', 'y', 'x']);
  });
});
