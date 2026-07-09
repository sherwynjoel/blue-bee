/**
 * Pure quote arithmetic (PRD §8.3): `service × measure × rate (+ upcharges)`,
 * subtotal = Σ lines, optional audited manual adjustment, tax = subtotal × HST rate,
 * total = subtotal + tax. No I/O — unit-tested in `quote-calc.spec.ts`. The rate is
 * already resolved (per-account override → list → service base) before it gets here.
 */
import { centsToMoney, roundCents } from './money';

export interface QuoteLineInput {
  itemId: string;
  serviceId: string;
  serviceName: string;
  unit: string;
  measure: number;
  rate: number;
  rateSource: string;
  upcharges: { code: string; label: string; amount: number }[];
}

export interface ComputedLine {
  itemId: string;
  serviceId: string;
  serviceName: string;
  unit: string;
  measure: number;
  rate: number;
  rateSource: string;
  baseAmount: string;
  upcharges: { code: string; label: string; amount: string }[];
  upchargeTotal: string;
  amount: string;
}

export interface ManualAdjustmentInput {
  reason: string;
  amount: number;
  actorId: string;
}

export interface ComputedQuote {
  lines: ComputedLine[];
  taxRate: number;
  subtotalBeforeAdjustment: string;
  adjustment: { reason: string; actorId: string; amount: string; before: string; after: string } | null;
  /**
   * [Inc-22] The configurable minimum-order floor top-up applied to the subtotal (decimal string), or null
   * when the computed subtotal already met/exceeded the floor (or no floor is configured). TODO: kg banding
   * can be layered later if wanted; today pricing is exact measure × rate + this order-level floor.
   */
  minimumTopUp: string | null;
  subtotal: string;
  tax: string;
  total: string;
}

export class QuoteCalcError extends Error {}

/**
 * Compute a quote from already-resolved line inputs. Throws `QuoteCalcError` on
 * invalid measures (≤ 0 or non-finite) or an adjustment that drives the subtotal
 * below zero — surfaced by the caller as a 422 problem+json. `opts.minOrderCents` [Inc-22] applies the
 * configurable minimum-order floor: after lines (+ any manual adjustment), the subtotal is topped up to the
 * floor if it falls short (max(subtotal, floor)); tax is charged on the floored subtotal.
 */
export function computeQuote(
  lines: QuoteLineInput[],
  taxRate: number,
  adjustment?: ManualAdjustmentInput,
  opts?: { minOrderCents?: number },
): ComputedQuote {
  if (lines.length === 0) throw new QuoteCalcError('a quote needs at least one line');
  if (!(taxRate >= 0 && taxRate < 1)) throw new QuoteCalcError(`invalid tax rate ${taxRate}`);

  let subtotalCents = 0;
  const computed: ComputedLine[] = lines.map((l) => {
    if (!Number.isFinite(l.measure) || l.measure <= 0) {
      throw new QuoteCalcError(`measure for item ${l.itemId} must be a positive number (got ${l.measure})`);
    }
    if (!Number.isFinite(l.rate) || l.rate < 0) {
      throw new QuoteCalcError(`rate for item ${l.itemId} must be non-negative (got ${l.rate})`);
    }
    const baseCents = roundCents(l.measure * l.rate);
    let upchargeCents = 0;
    const upcharges = l.upcharges.map((u) => {
      if (!Number.isFinite(u.amount) || u.amount < 0) {
        throw new QuoteCalcError(`upcharge ${u.code} must be non-negative`);
      }
      const c = roundCents(u.amount);
      upchargeCents += c;
      return { code: u.code, label: u.label, amount: centsToMoney(c) };
    });
    const amountCents = baseCents + upchargeCents;
    subtotalCents += amountCents;
    return {
      itemId: l.itemId,
      serviceId: l.serviceId,
      serviceName: l.serviceName,
      unit: l.unit,
      measure: l.measure,
      rate: l.rate,
      rateSource: l.rateSource,
      baseAmount: centsToMoney(baseCents),
      upcharges,
      upchargeTotal: centsToMoney(upchargeCents),
      amount: centsToMoney(amountCents),
    };
  });

  const subtotalBeforeAdjustment = subtotalCents;
  let adjustmentRecord: ComputedQuote['adjustment'] = null;
  if (adjustment) {
    const adjCents = roundCents(adjustment.amount);
    const after = subtotalCents + adjCents;
    if (after < 0) {
      throw new QuoteCalcError('manual adjustment cannot drive the subtotal below zero');
    }
    adjustmentRecord = {
      reason: adjustment.reason,
      actorId: adjustment.actorId,
      amount: centsToMoney(adjCents),
      before: centsToMoney(subtotalCents),
      after: centsToMoney(after),
    };
    subtotalCents = after;
  }

  // [Inc-22] Minimum-order floor: top the subtotal up to the configured floor if it falls short.
  let minimumTopUp: string | null = null;
  const floorCents = opts?.minOrderCents;
  if (floorCents !== undefined) {
    if (!(Number.isInteger(floorCents) && floorCents >= 0)) {
      throw new QuoteCalcError(`minimum-order floor must be a non-negative integer number of cents (got ${floorCents})`);
    }
    if (subtotalCents < floorCents) {
      minimumTopUp = centsToMoney(floorCents - subtotalCents);
      subtotalCents = floorCents;
    }
  }

  const taxCents = roundCents((subtotalCents / 100) * taxRate);
  const totalCents = subtotalCents + taxCents;

  return {
    lines: computed,
    taxRate,
    subtotalBeforeAdjustment: centsToMoney(subtotalBeforeAdjustment),
    adjustment: adjustmentRecord,
    minimumTopUp,
    subtotal: centsToMoney(subtotalCents),
    tax: centsToMoney(taxCents),
    total: centsToMoney(totalCents),
  };
}
