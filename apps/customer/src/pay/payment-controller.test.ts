import { OrderStatus, PaymentStatus, QuoteStatus, type PaymentView } from '@blue-bee/shared';
import type { OrderDetail } from '../api/types';
import { isPayable, payAmount, pollPaymentConfirmed } from './payment-controller';

function order(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'o1',
    orgId: 'g',
    accountId: 'a',
    pricingAccountId: null,
    pricingAccount: null,
    siteId: null,
    vertical: 'SPECIALTY',
    type: 'JOB',
    status: OrderStatus.QUOTE_APPROVED,
    heldFrom: null,
    scheduledPickupWindow: null,
    scheduledDeliveryWindow: null,
    totals: { currency: 'CAD', total: '293.80' },
    createdAt: 'c',
    updatedAt: 'u',
    items: [],
    quotes: [{ id: 'q', status: QuoteStatus.APPROVED, subtotal: '260.00', tax: '33.80', total: '293.80', lines: [], adjustments: null, expiresAt: null, approvedBy: 'x', approvedAt: 'y', createdAt: 'c' }],
    routeStops: [],
    ...over,
  };
}

const pay = (status: PaymentStatus): PaymentView => ({
  id: 'p1', orderId: 'o1', invoiceId: null, method: 'CARD' as never, amount: '293.80', currency: 'CAD',
  status, capturedAmount: status === PaymentStatus.SUCCEEDED ? '293.80' : '0.00', refundedAmount: '0.00', attempts: 1, createdAt: 'c', capturedAt: null,
});

describe('isPayable', () => {
  it('payable when approved + not yet paid', () => {
    expect(isPayable(order())).toBe(true);
  });
  it('not payable once paid / refunded', () => {
    expect(isPayable(order({ totals: { paymentStatus: 'PAID' } }))).toBe(false);
    expect(isPayable(order({ totals: { paymentStatus: 'REFUNDED' } }))).toBe(false);
    expect(isPayable(order({ totals: { paymentStatus: 'PARTIALLY_REFUNDED' } }))).toBe(false);
  });
  it('not payable for a declined / closed-no-work / pre-approval order', () => {
    expect(isPayable(order({ status: OrderStatus.QUOTE_DECLINED, quotes: [] }))).toBe(false);
    expect(isPayable(order({ status: OrderStatus.CLOSED_NO_WORK, quotes: [] }))).toBe(false);
    expect(isPayable(order({ status: OrderStatus.QUOTED, quotes: [] }))).toBe(false);
  });
  it('payable later in the lifecycle if still approved + unpaid (e.g. DELIVERED)', () => {
    expect(isPayable(order({ status: OrderStatus.DELIVERED }))).toBe(true);
  });
});

describe('payAmount', () => {
  it('is the approved quote total (incl. HST)', () => {
    expect(payAmount(order())).toBe('293.80');
  });
  it('falls back to totals.total when no approved quote', () => {
    expect(payAmount(order({ quotes: [], totals: { total: '50.00' } }))).toBe('50.00');
  });
});

describe('pollPaymentConfirmed', () => {
  const noDelay = jest.fn(async () => undefined);

  it('returns immediately on a terminal SUCCEEDED (no waiting)', async () => {
    const getPayment = jest.fn().mockResolvedValue(pay(PaymentStatus.SUCCEEDED));
    const res = await pollPaymentConfirmed(getPayment, noDelay, { attempts: 6, intervalMs: 10 });
    expect(res?.status).toBe('SUCCEEDED');
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(noDelay).not.toHaveBeenCalled();
  });

  it('polls past PENDING until the webhook confirms', async () => {
    const getPayment = jest.fn().mockResolvedValueOnce(pay(PaymentStatus.PENDING)).mockResolvedValueOnce(pay(PaymentStatus.PENDING)).mockResolvedValueOnce(pay(PaymentStatus.SUCCEEDED));
    const res = await pollPaymentConfirmed(getPayment, noDelay, { attempts: 6, intervalMs: 10 });
    expect(res?.status).toBe('SUCCEEDED');
    expect(getPayment).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget, returning the last (still-PENDING) view', async () => {
    const getPayment = jest.fn().mockResolvedValue(pay(PaymentStatus.PENDING));
    const res = await pollPaymentConfirmed(getPayment, noDelay, { attempts: 3, intervalMs: 10 });
    expect(res?.status).toBe('PENDING');
    expect(getPayment).toHaveBeenCalledTimes(3);
  });

  it('treats a transient read error as a retry, never throwing', async () => {
    const getPayment = jest.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(pay(PaymentStatus.SUCCEEDED));
    const res = await pollPaymentConfirmed(getPayment, noDelay, { attempts: 4, intervalMs: 10 });
    expect(res?.status).toBe('SUCCEEDED');
  });

  it('stops on a terminal FAILED (does not loop forever)', async () => {
    const getPayment = jest.fn().mockResolvedValue(pay(PaymentStatus.FAILED));
    const res = await pollPaymentConfirmed(getPayment, noDelay, { attempts: 6, intervalMs: 10 });
    expect(res?.status).toBe('FAILED');
    expect(getPayment).toHaveBeenCalledTimes(1);
  });
});
