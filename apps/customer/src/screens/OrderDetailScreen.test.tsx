import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderStatus, QuoteStatus, WeighPoint, type OrderWeightView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { OrderDetail } from '../api/types';

// useFocusEffect → run on mount like useEffect (no NavigationContainer in the test).
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react') as typeof import('react');
  return {
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => cb(), []),
  };
});

const mockClient = {
  getOrder: jest.fn(),
  approveQuote: jest.fn(),
  declineQuote: jest.fn(),
  getUnreadCount: jest.fn(),
  // [Inc-23 P4] best-effort weight line + live order-room channel (default: no weight, no active channel).
  getOrderWeight: jest.fn(async (): Promise<OrderWeightView> => ({ orderId: 'order-aaaa1111', authoritativeWeightKg: null, authoritativeWeighPoint: null, captures: [], customerEstimate: null })),
  getMessagesChannel: jest.fn(async () => ({ channelToken: null, stopId: null, vehicleId: null })),
};
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { OrderDetailScreen } from './OrderDetailScreen';

jest.setTimeout(30000);

function quotedOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-aaaa1111',
    orgId: 'org',
    accountId: 'acc',
    pricingAccountId: null,
    pricingAccount: null,
    siteId: null,
    vertical: 'SPECIALTY',
    type: 'JOB',
    status: OrderStatus.QUOTED,
    heldFrom: null,
    scheduledPickupWindow: null,
    scheduledDeliveryWindow: null,
    totals: { currency: 'CAD' },
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    items: [
      {
        id: 'item-1',
        kind: 'RUG' as never,
        status: 'INSPECTED' as never,
        measurements: {},
        inspections: [{ id: 'ins-1', preexistingDamage: true, conditionCodes: ['frayed'], notes: null, ackBy: 'u', ackAt: '2026-06-25T00:00:00.000Z', createdAt: '2026-06-25T00:00:00.000Z' }],
        photos: [{ id: 'p1', kind: 'INTAKE' as never, contentType: 'image/jpeg', sizeBytes: 100, takenAt: 't', createdAt: 'c', downloadUrl: 'https://minio/get?sig=1' }],
        custodyEvents: [],
      },
    ],
    quotes: [
      { id: 'q1', status: QuoteStatus.SENT, subtotal: '100.00', tax: '13.00', total: '113.00', lines: [], adjustments: null, expiresAt: '2099-01-01T00:00:00.000Z', approvedBy: null, approvedAt: null, createdAt: '2026-06-25T00:00:00.000Z' },
    ],
    routeStops: [],
    rating: null,
    ...over,
  };
}

const navigation = { navigate: jest.fn(), replace: jest.fn() } as never;
const route = { params: { orderId: 'order-aaaa1111' } } as never;

describe('OrderDetailScreen', () => {
  beforeEach(() => {
    mockClient.getOrder.mockReset();
    mockClient.approveQuote.mockReset();
    mockClient.declineQuote.mockReset();
    mockClient.getUnreadCount.mockReset();
    // The order screen fetches the chat unread badge (Inc-18) best-effort on load.
    mockClient.getUnreadCount.mockResolvedValue({ orderId: 'order-aaaa1111', unreadCount: 0 });
  });

  it('renders the timeline, the pre-existing-damage notice + photo, and the quote (from server state)', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    const { getByTestId, getAllByTestId, findByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    await findByTestId('status-timeline');
    expect(getByTestId('damage-notice')).toBeTruthy();
    expect(getAllByTestId('photo-p1').length).toBeGreaterThan(0); // signed downloadUrl rendered
    expect(getByTestId('approve-quote')).toBeTruthy();
  });

  it('[Inc-23 P4] shows the "Weighed X kg → $Y" line when the order has an authoritative weight', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder({ status: OrderStatus.QUOTE_APPROVED, totals: { currency: 'CAD', total: '23.73' } }));
    mockClient.getOrderWeight.mockResolvedValue({
      orderId: 'order-aaaa1111',
      authoritativeWeightKg: '6.00',
      authoritativeWeighPoint: WeighPoint.PLANT,
      captures: [{ id: 'c1', orderId: 'order-aaaa1111', itemId: null, weightKg: '6.00', weighPoint: WeighPoint.PLANT, capturedByUserId: 'u', capturedAt: '2026-07-10T00:00:00.000Z', source: 'driver', note: null }],
      customerEstimate: 5,
    });
    const { findByTestId, getByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    expect(await findByTestId('order-weighed')).toBeTruthy();
    expect(getByTestId('order-weighed-price')).toBeTruthy(); // → $23.73 (no fabricated number; the server total)
  });

  it('[Inc-23 P4] shows a pending state (no fake number) until a real weight exists', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    mockClient.getOrderWeight.mockResolvedValue({ orderId: 'order-aaaa1111', authoritativeWeightKg: null, authoritativeWeighPoint: null, captures: [], customerEstimate: 5 });
    const { findByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    expect(await findByTestId('order-weight-pending')).toBeTruthy();
  });

  it('shows the corporate-pricing indicator when the order is priced on a corporate account (server truth)', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder({ pricingAccountId: 'corp-1', pricingAccount: { name: 'Maple District Towers' } }));
    const { findByTestId, getByText } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    expect(await findByTestId('corp-pricing-note')).toBeTruthy();
    expect(getByText('Maple District Towers', { exact: false })).toBeTruthy();
  });

  it('hides the corporate-pricing indicator on a default-priced order (pricingAccount null)', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder()); // fixture default: pricingAccount = null
    const { findByTestId, queryByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    await findByTestId('status-timeline');
    expect(queryByTestId('corp-pricing-note')).toBeNull();
  });

  it('approve → calls approveQuote and shows Approved', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    mockClient.approveQuote.mockResolvedValue(quotedOrder({ status: OrderStatus.QUOTE_APPROVED, quotes: [{ id: 'q1', status: QuoteStatus.APPROVED, subtotal: '100.00', tax: '13.00', total: '113.00', lines: [], adjustments: null, expiresAt: null, approvedBy: 'u', approvedAt: 'now', createdAt: 'c' }] }));
    const { findByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    const approve = await findByTestId('approve-quote');
    fireEvent.press(approve);
    await waitFor(() => expect(mockClient.approveQuote).toHaveBeenCalledWith('order-aaaa1111'));
    await findByTestId('quote-approved');
  });

  it('a 409 on approve re-syncs to server truth (re-reads the order) instead of fighting it', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    mockClient.approveQuote.mockRejectedValue(new ApiError(409, { error: 'quote_expired' }, 'The quote has expired'));
    const { findByTestId, getByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    const approve = await findByTestId('approve-quote');
    mockClient.getOrder.mockClear(); // count only the re-sync read
    fireEvent.press(approve);
    await waitFor(() => expect(mockClient.getOrder).toHaveBeenCalled()); // re-synced to truth
    await findByTestId('action-msg');
    expect(getByTestId('action-msg').props.children).toMatch(/expired|refreshed/i);
  });

  // ───────────── Inc-32 — the rating CTA / read-only score ─────────────

  it('shows the "Rate this order" CTA on a delivered, unrated order', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder({ status: OrderStatus.DELIVERED }));
    const { findByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    expect(await findByTestId('rate-cta')).toBeTruthy();
  });

  it('hides the rate CTA until the order has been delivered', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder()); // QUOTED
    const { findByTestId, queryByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    await findByTestId('status-timeline');
    expect(queryByTestId('rate-cta')).toBeNull();
  });

  it('shows the submitted score read-only once the delivered order is rated (no CTA)', async () => {
    mockClient.getOrder.mockResolvedValue(
      quotedOrder({
        status: OrderStatus.DELIVERED,
        rating: { id: 'r1', orderId: 'order-aaaa1111', score: 4, comment: 'Nice work', submittedByUserId: 'u', createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z', editable: true },
      }),
    );
    const { findByTestId, queryByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    expect(await findByTestId('order-rating-score')).toBeTruthy();
    expect(queryByTestId('rate-cta')).toBeNull();
  });
});
