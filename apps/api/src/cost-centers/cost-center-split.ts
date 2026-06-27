import type { CostCenterBreakdownEntry } from '@blue-bee/shared';
import { centsToMoney, decimalMoney } from '../orders/money';

/** Normalize a stored money string to fixed-2 ("100.8" → "100.80"); leaves legacy garbage untouched. */
function fixed2(v: unknown): string {
  const s = String(v ?? '0.00');
  try {
    return decimalMoney(s);
  } catch {
    return s;
  }
}

/**
 * The cost-centre split math (PRD §A5.2) — pure + unit-locked (`cost-center-split.spec.ts`).
 *
 * Given the per-order billable lines of a batch invoice (each already reduced to integer cents) and a
 * code/name lookup for the referenced cost centres, partition them by `costCenterId` into the structured
 * breakdown written to `Invoice.costCenterBreakdown`. The partition is exact: every line lands in exactly
 * one bucket, so the split subtotals/taxes/totals SUM EXACTLY to the invoice subtotal/tax/total (no
 * rounding leak — the cents are summed, money strings are rendered only at the end). Orders with no cost
 * centre fall into an explicit "Unassigned" bucket (honest — never silently dropped).
 */

/** A billable line reduced to integer cents, tagged with its order's cost centre (null ⇒ unassigned). */
export interface SplitLine {
  costCenterId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export interface CostCenterMeta {
  code: string;
  name: string;
}

/** The explicit bucket for lines whose order has no cost centre. */
export const UNASSIGNED = { code: 'UNASSIGNED', name: 'Unassigned' } as const;

const UNASSIGNED_KEY = ' unassigned';

/**
 * Build the reconciling `costCenterBreakdown` from billable lines + a cost-centre meta map. Buckets are
 * ordered deterministically (named centres by code ascending, the "Unassigned" bucket always last) so a
 * re-run produces a byte-identical breakdown.
 */
export function buildCostCenterBreakdown(
  lines: SplitLine[],
  meta: Map<string, CostCenterMeta>,
): CostCenterBreakdownEntry[] {
  const groups = new Map<string, { id: string | null; subtotal: number; tax: number; total: number }>();
  for (const l of lines) {
    const key = l.costCenterId ?? UNASSIGNED_KEY;
    const g = groups.get(key) ?? { id: l.costCenterId, subtotal: 0, tax: 0, total: 0 };
    g.subtotal += l.subtotalCents;
    g.tax += l.taxCents;
    g.total += l.totalCents;
    groups.set(key, g);
  }

  const entries: CostCenterBreakdownEntry[] = [...groups.values()].map((g) => {
    const m = g.id ? meta.get(g.id) : null;
    // A referenced centre is always resolvable (FK SET NULL nulls a deleted centre's orders → they land
    // in Unassigned); the id-prefix fallback is defensive only.
    const code = g.id ? m?.code ?? g.id.slice(0, 8).toUpperCase() : UNASSIGNED.code;
    const name = g.id ? m?.name ?? code : UNASSIGNED.name;
    return {
      costCenterId: g.id,
      code,
      name,
      subtotal: centsToMoney(g.subtotal),
      tax: centsToMoney(g.tax),
      total: centsToMoney(g.total),
    };
  });

  entries.sort((a, b) => {
    if (a.costCenterId === null) return 1; // Unassigned last
    if (b.costCenterId === null) return -1;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });
  return entries;
}

/**
 * Normalize a stored `Invoice.costCenterBreakdown` JSON back to typed entries for the API read. The
 * column defaults to `{}` (an un-split / pre-Phase-2 invoice) → an empty array; a populated array is
 * mapped through defensively (money stays as the stored fixed-2 strings). Surfaced by BOTH invoice
 * `toView` mappers so every invoice read carries a (possibly empty) breakdown.
 */
export function parseStoredBreakdown(json: unknown): CostCenterBreakdownEntry[] {
  if (!Array.isArray(json)) return [];
  return json
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      costCenterId: typeof e.costCenterId === 'string' ? e.costCenterId : null,
      code: String(e.code ?? ''),
      name: String(e.name ?? ''),
      // Normalize to fixed-2 so the on-screen split (web money()) can never drop cents vs the PDF.
      subtotal: fixed2(e.subtotal),
      tax: fixed2(e.tax),
      total: fixed2(e.total),
    }));
}
