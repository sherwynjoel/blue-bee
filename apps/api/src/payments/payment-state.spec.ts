import { PaymentStatus } from '@blue-bee/shared';
import { canPaymentTransition, isFullyRefunded, refundableCents, resolveRefundCents } from './payment-state';
import { mapDisputeStatus } from './dispute.service';
import { moneyToCents } from '../orders/money';

describe('payment-state (pure)', () => {
  describe('canPaymentTransition', () => {
    it('allows the legal Payment transitions', () => {
      expect(canPaymentTransition(PaymentStatus.PENDING, PaymentStatus.SUCCEEDED)).toBe(true);
      expect(canPaymentTransition(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
      expect(canPaymentTransition(PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)).toBe(true);
    });
    it('rejects illegal transitions (terminal + backwards)', () => {
      expect(canPaymentTransition(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED)).toBe(false);
      expect(canPaymentTransition(PaymentStatus.REFUNDED, PaymentStatus.SUCCEEDED)).toBe(false);
      expect(canPaymentTransition(PaymentStatus.PENDING, PaymentStatus.REFUNDED)).toBe(false);
      expect(canPaymentTransition(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED)).toBe(false);
    });
  });

  describe('refundableCents', () => {
    it('is captured minus refunded, never negative', () => {
      expect(refundableCents(29380, 0)).toBe(29380);
      expect(refundableCents(29380, 10000)).toBe(19380);
      expect(refundableCents(29380, 29380)).toBe(0);
      expect(refundableCents(29380, 40000)).toBe(0);
    });
  });

  describe('resolveRefundCents', () => {
    it('full refund (omitted amount) = the remaining balance', () => {
      expect(resolveRefundCents(29380, 0, undefined)).toEqual({ cents: 29380, isFull: true });
      expect(resolveRefundCents(29380, 9380, undefined)).toEqual({ cents: 20000, isFull: true });
    });
    it('partial refund within the balance', () => {
      expect(resolveRefundCents(29380, 0, 10000)).toEqual({ cents: 10000, isFull: false });
      // a partial that exactly empties the balance is "full"
      expect(resolveRefundCents(29380, 19380, 10000)).toEqual({ cents: 10000, isFull: true });
    });
    it('rejects an over-refund', () => {
      expect(() => resolveRefundCents(29380, 0, 30000)).toThrow(/exceeds/);
      expect(() => resolveRefundCents(29380, 29380, undefined)).toThrow(/nothing left/);
      expect(() => resolveRefundCents(29380, 0, 0)).toThrow(/positive/);
      expect(() => resolveRefundCents(29380, 0, -5)).toThrow(/positive/);
    });
  });

  describe('isFullyRefunded', () => {
    it('true only when refunded ≥ captured (and captured > 0)', () => {
      expect(isFullyRefunded(29380, 29380)).toBe(true);
      expect(isFullyRefunded(29380, 29381)).toBe(true);
      expect(isFullyRefunded(29380, 29379)).toBe(false);
      expect(isFullyRefunded(0, 0)).toBe(false);
    });
  });
});

describe('moneyToCents (Stripe minor units)', () => {
  it('parses fixed-2 money strings exactly', () => {
    expect(moneyToCents('293.80')).toBe(29380);
    expect(moneyToCents('0.00')).toBe(0);
    expect(moneyToCents('5')).toBe(500);
    expect(moneyToCents('5.5')).toBe(550);
    expect(moneyToCents('1000000.99')).toBe(100000099);
    expect(moneyToCents('-12.00')).toBe(-1200);
  });
  it('throws on a malformed amount (a bad amount can never charge)', () => {
    expect(() => moneyToCents('12.345')).toThrow();
    expect(() => moneyToCents('abc')).toThrow();
    expect(() => moneyToCents('')).toThrow();
  });
});

describe('mapDisputeStatus', () => {
  it('maps the Stripe dispute lifecycle to our coarse status', () => {
    expect(mapDisputeStatus('needs_response')).toBe('OPEN');
    expect(mapDisputeStatus('warning_needs_response')).toBe('OPEN');
    expect(mapDisputeStatus('under_review')).toBe('UNDER_REVIEW');
    expect(mapDisputeStatus('won')).toBe('WON');
    expect(mapDisputeStatus('lost')).toBe('LOST');
    expect(mapDisputeStatus('charge_refunded')).toBe('CLOSED');
  });
});
