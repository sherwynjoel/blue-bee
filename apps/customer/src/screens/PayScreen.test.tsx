import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
import type { OrderDetail } from '../api/types';

const mockClient = {
  getOrder: jest.fn(),
  getPayment: jest.fn(),
  getInvoice: jest.fn(),
  createPaymentIntent: jest.fn(),
};
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

const mockPresent = jest.fn();
jest.mock('../pay/use-payment-sheet', () => ({ usePresentPayment: () => mockPresent }));

import { PayScreen } from './PayScreen';

jest.setTimeout(30000);

function approvedOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-bbbb2222',
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
    rating: null,
    ...over,
  };
}

const succeededPayment = { id: 'p1', orderId: 'order-bbbb2222', invoiceId: 'i1', method: 'CARD', amount: '293.80', currency: 'CAD', status: 'SUCCEEDED', capturedAmount: '293.80', refundedAmount: '0.00', attempts: 1, createdAt: 'c', capturedAt: 't' };
const receipt = { id: 'i1', orderId: 'order-bbbb2222', number: 'INV-ORDER-BB', status: 'PAID', subtotal: '260.00', tax: '33.80', total: '293.80', currency: 'CAD', lines: [{ description: 'Rug cleaning', quantity: 1, unitAmount: '260.00', amount: '260.00' }, { description: 'HST (13%)', quantity: 1, unitAmount: '33.80', amount: '33.80' }], issuedAt: 't', paidAt: 't', dueAt: null, createdAt: 'c' };

const nav = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { params: { orderId: 'order-bbbb2222' }, key: 'k', name: 'Pay' } as never;

beforeEach(() => jest.clearAllMocks());

describe('PayScreen', () => {
  it('pay → PaymentSheet success → polls the webhook-confirmed payment → shows the receipt', async () => {
    mockClient.getOrder.mockResolvedValue(approvedOrder());
    mockClient.getPayment.mockResolvedValueOnce(null).mockResolvedValueOnce(succeededPayment); // mount=null, poll=SUCCEEDED
    mockClient.createPaymentIntent.mockResolvedValue({ paymentId: 'p1', clientSecret: 'pi_x_secret_y', amount: '293.80', currency: 'CAD', status: 'PENDING', publishableKey: null });
    mockPresent.mockResolvedValue({ outcome: 'paid' });
    mockClient.getInvoice.mockResolvedValue(receipt);

    const { getByTestId, queryByTestId } = render(<PayScreen navigation={nav} route={route} />);
    await waitFor(() => expect(getByTestId('pay-button')).toBeTruthy());

    fireEvent.press(getByTestId('pay-button'));

    await waitFor(() => expect(getByTestId('receipt')).toBeTruthy());
    expect(mockClient.createPaymentIntent).toHaveBeenCalledWith('order-bbbb2222');
    expect(mockPresent).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'pi_x_secret_y' }));
    expect(queryByTestId('pay-error')).toBeNull();
  });

  it('PaymentSheet failure → shows the error + a Try again button (no false "paid")', async () => {
    mockClient.getOrder.mockResolvedValue(approvedOrder());
    mockClient.getPayment.mockResolvedValue(null);
    mockClient.createPaymentIntent.mockResolvedValue({ paymentId: 'p1', clientSecret: 'pi_x_secret_y', amount: '293.80', currency: 'CAD', status: 'PENDING', publishableKey: null });
    mockPresent.mockResolvedValue({ outcome: 'failed', error: 'Your card was declined.' });

    const { getByTestId, queryByTestId } = render(<PayScreen navigation={nav} route={route} />);
    await waitFor(() => expect(getByTestId('pay-button')).toBeTruthy());

    fireEvent.press(getByTestId('pay-button'));

    await waitFor(() => expect(getByTestId('pay-error')).toBeTruthy());
    expect(queryByTestId('receipt')).toBeNull();
    // The webhook poll was never consulted (the sheet failed) and we never claimed success.
    expect(mockClient.getInvoice).not.toHaveBeenCalled();
  });

  it('an already-paid order shows the receipt without re-charging', async () => {
    mockClient.getOrder.mockResolvedValue(approvedOrder({ totals: { currency: 'CAD', total: '293.80', paymentStatus: 'PAID' } }));
    mockClient.getPayment.mockResolvedValue(succeededPayment);
    mockClient.getInvoice.mockResolvedValue(receipt);

    const { getByTestId, queryByTestId } = render(<PayScreen navigation={nav} route={route} />);
    await waitFor(() => expect(getByTestId('receipt')).toBeTruthy());
    expect(queryByTestId('pay-button')).toBeNull();
    expect(mockClient.createPaymentIntent).not.toHaveBeenCalled();
  });
});
