import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
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
};
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { OrderDetailScreen } from './OrderDetailScreen';

jest.setTimeout(30000);

function quotedOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-aaaa1111',
    orgId: 'org',
    accountId: 'acc',
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
  });

  it('renders the timeline, the pre-existing-damage notice + photo, and the quote (from server state)', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    const { getByTestId, getAllByTestId, findByTestId } = render(<OrderDetailScreen navigation={navigation} route={route} />);
    await findByTestId('status-timeline');
    expect(getByTestId('damage-notice')).toBeTruthy();
    expect(getAllByTestId('photo-p1').length).toBeGreaterThan(0); // signed downloadUrl rendered
    expect(getByTestId('approve-quote')).toBeTruthy();
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
});
