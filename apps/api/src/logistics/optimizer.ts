/**
 * Route sequencing (PRD §6.2/§6.3) behind a swappable seam so Google Route
 * Optimization / Onfleet / Routific can replace the in-house engine later WITHOUT
 * touching callers. The default engine is a deterministic greedy nearest-neighbour
 * that respects stop time windows; distances are real PostGIS geography distances
 * supplied by the caller (see optimizer.service.ts) — this module is the pure,
 * unit-tested ORDERING algorithm, not the distance computation.
 */

export interface OptimizerStop {
  id: string;
  /** True if the stop has a usable coordinate (its site has a geo point). */
  hasCoord: boolean;
  /** Time-window start in epoch ms, or null if the stop has no window. */
  windowStartMs: number | null;
  /** Original input index — deterministic tiebreak. */
  index: number;
}

/** Distance in metres between two ids. `'DEPOT'` is a valid `fromId` when a depot exists. */
export type DistanceLookup = (fromId: string, toId: string) => number;

export interface OptimizerInput {
  stops: OptimizerStop[];
  hasDepot: boolean;
  distance: DistanceLookup;
}

export interface RouteOptimizer {
  readonly name: string;
  /** Returns ALL input stop ids in visit order (coordinate-less stops appended, input order). */
  sequence(input: OptimizerInput): string[];
}

/**
 * Greedy nearest-neighbour with time-window priority.
 *  • Stops with an earlier time-window start are visited first (hard ordering).
 *  • Ties / window-free stops are ordered by nearest distance from the running position
 *    (the depot first if present, else the first stop by input index).
 *  • Stops without a coordinate can't be spatially sequenced → appended last, input order.
 * Deterministic for a given input (stable index tiebreak).
 */
export class NearestNeighbourOptimizer implements RouteOptimizer {
  readonly name = 'nearest_neighbour';

  sequence({ stops, hasDepot, distance }: OptimizerInput): string[] {
    const withCoord = stops.filter((s) => s.hasCoord);
    const without = stops.filter((s) => !s.hasCoord).sort((a, b) => a.index - b.index);

    const ordered: string[] = [];
    const remaining = [...withCoord];
    let current: string | null = hasDepot ? 'DEPOT' : null;

    while (remaining.length > 0) {
      let best = 0;
      for (let i = 1; i < remaining.length; i++) {
        if (this.prefer(remaining[i], remaining[best], current, distance)) best = i;
      }
      const next = remaining.splice(best, 1)[0];
      ordered.push(next.id);
      current = next.id;
    }
    return [...ordered, ...without.map((s) => s.id)];
  }

  /** True if `a` should be visited before `b` from `current`. */
  private prefer(a: OptimizerStop, b: OptimizerStop, current: string | null, distance: DistanceLookup): boolean {
    const wa = a.windowStartMs ?? Number.POSITIVE_INFINITY;
    const wb = b.windowStartMs ?? Number.POSITIVE_INFINITY;
    if (wa !== wb) return wa < wb; // earliest time window wins
    if (current !== null) {
      const da = distance(current, a.id);
      const db = distance(current, b.id);
      if (da !== db) return da < db; // then nearest
    }
    return a.index < b.index; // deterministic tiebreak
  }
}
