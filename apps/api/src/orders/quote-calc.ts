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
  subtotal: string;
  tax: string;
  total: string;
}

export class QuoteCalcError extends Error {}

/**
 * Compute a quote from already-resolved line inputs. Throws `QuoteCalcError` on
 * invalid measures (≤ 0 or non-finite) or an adjustment that drives the subtotal
 * below zero — surfaced by the caller as a 422 problem+json.
 */
export function computeQuote(
  lines: QuoteLineInput[],
  taxRate: number,
  adjustment?: ManualAdjustmentInput,
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

  const taxCents = roundCents((subtotalCents / 100) * taxRate);
  const totalCents = subtotalCents + taxCents;

  return {
    lines: computed,
    taxRate,
    subtotalBeforeAdjustment: centsToMoney(subtotalBeforeAdjustment),
    adjustment: adjustmentRecord,
    subtotal: centsToMoney(subtotalCents),
    tax: centsToMoney(taxCents),
    total: centsToMoney(totalCents),
  };
}
