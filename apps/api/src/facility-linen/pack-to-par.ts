/**
 * Pack-to-par load-sheet math (PRD §5.2 PACK_TO_PAR, §B3.2) — pure, exhaustively unit-tested. The load
 * sheet answers "what to pack to refill each site/cost-centre to par": for every par target, the gap is
 * `max(0, targetQty − onHand)` — never negative (already at/over par ⇒ 0, never an over-pack). On-hand is
 * keyed identically to par (site, cost-centre?, sku), so the gap is computed at the exact granularity par
 * is set and a NULL cost-centre (site-level) par never bleeds into a wing's gap.
 */
import type { ServiceUnit } from '@blue-bee/shared';

export interface ParInput {
  serviceId: string;
  costCenterId: string | null;
  targetQty: number;
  sku: string;
  unit: ServiceUnit;
}

export interface StockInput {
  serviceId: string;
  costCenterId: string | null;
  onHand: number;
}

export interface PackToParLineComputed {
  serviceId: string;
  sku: string;
  unit: ServiceUnit;
  costCenterId: string | null;
  par: number;
  onHand: number;
  gap: number;
}

/** Stable key for a (cost-centre?, sku) cell — a NULL cost-centre is its own distinct cell. */
function cell(costCenterId: string | null, serviceId: string): string {
  return `${costCenterId ?? '∅'}::${serviceId}`;
}

/**
 * Compute the pack-to-par lines from par targets + on-hand. Each par row yields one line (gap = max(0,
 * par − onHand)); on-hand with no matching par is NOT in the sheet (the load sheet is par-driven). When
 * `filterCostCenterId` is provided, only that cost-centre's par rows are returned. Deterministic order:
 * by cost-centre (site-level NULL last), then SKU name.
 */
export function computePackToParLines(
  pars: ParInput[],
  stock: StockInput[],
  filterCostCenterId?: string,
): PackToParLineComputed[] {
  const onHandByCell = new Map<string, number>();
  for (const s of stock) onHandByCell.set(cell(s.costCenterId, s.serviceId), s.onHand);

  const lines = pars
    .filter((p) => filterCostCenterId === undefined || p.costCenterId === filterCostCenterId)
    .map((p): PackToParLineComputed => {
      const onHand = onHandByCell.get(cell(p.costCenterId, p.serviceId)) ?? 0;
      return {
        serviceId: p.serviceId,
        sku: p.sku,
        unit: p.unit,
        costCenterId: p.costCenterId,
        par: p.targetQty,
        onHand,
        gap: Math.max(0, p.targetQty - onHand),
      };
    });

  lines.sort((a, b) => {
    if (a.costCenterId !== b.costCenterId) {
      if (a.costCenterId === null) return 1; // site-level (NULL) sorts last
      if (b.costCenterId === null) return -1;
      return a.costCenterId < b.costCenterId ? -1 : 1;
    }
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });
  return lines;
}

/** Total pieces to pack across all lines (Σ gap). */
export function totalGap(lines: PackToParLineComputed[]): number {
  return lines.reduce((n, l) => n + l.gap, 0);
}
