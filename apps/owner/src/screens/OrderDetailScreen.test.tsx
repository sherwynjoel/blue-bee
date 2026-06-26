import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderStatus, QuoteStatus } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { OrderDetail } from '../api/types';

// useFocusEffect → run on mount like useEffect (no NavigationContainer in the test).
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react') as typeof import('react');
  return { useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => cb(), []) };
});

const mockClient = { getOrder: jest.fn(), approveQuote: jest.fn(), declineQuote: jest.fn() };
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { OrderDetailScreen } from './OrderDetailScreen';

jest.setTimeout(30000);

function quotedOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-aaaa1111',
    orgId: 'org',
    accountId: 'acc',
    status: OrderStatus.QUOTED,
    heldFrom: null,
    totals: { currency: 'CAD' },
    createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z',
    items: [
      {
        id: 'item-1',
        kind: 'RUG' as never,
        status: 'INSPECTED' as never,
        custodyEvents: [{ id: 'c1', stage: 'PICKED_UP', occurredAt: '2026-06-25T01:00:00.000Z' }],
      },
    ],
    quotes: [
      {
        id: 'q1',
        status: QuoteStatus.SENT,
        subtotal: '100.00',
        tax: '13.00',
        total: '113.00',
        expiresAt: '2099-01-01T00:00:00.000Z',
        approvedBy: null,
        approvedAt: null,
        createdAt: '2026-06-25T00:00:00.000Z',
      },
    ],
    routeStops: [],
    ...over,
  };
}

const route = { params: { orderId: 'order-aaaa1111' } } as never;

describe('OrderDetailScreen (owner drill-through + approve/decline)', () => {
  beforeEach(() => {
    mockClient.getOrder.mockReset();
    mockClient.approveQuote.mockReset();
    mockClient.declineQuote.mockReset();
  });

  it('renders the quote + chain of custody from server state and offers approve when QUOTED', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    const { findByTestId, getByTestId } = render(<OrderDetailScreen route={route} />);
    await findByTestId('order-detail');
    expect(getByTestId('item-item-1')).toBeTruthy(); // chain-of-custody item
    expect(getByTestId('approve-quote')).toBeTruthy();
  });

  it('approve → calls approveQuote (server-authoritative)', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    mockClient.approveQuote.mockResolvedValue(quotedOrder({ status: OrderStatus.QUOTE_APPROVED }));
    const { findByTestId } = render(<OrderDetailScreen route={route} />);
    const approve = await findByTestId('approve-quote');
    fireEvent.press(approve);
    await waitFor(() => expect(mockClient.approveQuote).toHaveBeenCalledWith('order-aaaa1111'));
    await findByTestId('action-msg');
  });

  it('a 409 on approve re-syncs to server truth (re-reads the order) instead of fighting it', async () => {
    mockClient.getOrder.mockResolvedValue(quotedOrder());
    mockClient.approveQuote.mockRejectedValue(new ApiError(409, { error: 'quote_expired' }, 'The quote has expired'));
    const { findByTestId, getByTestId } = render(<OrderDetailScreen route={route} />);
    const approve = await findByTestId('approve-quote');
    mockClient.getOrder.mockClear(); // count only the re-sync read
    fireEvent.press(approve);
    await waitFor(() => expect(mockClient.getOrder).toHaveBeenCalled()); // re-synced to truth
    await findByTestId('action-msg');
    expect(getByTestId('action-msg').props.children).toMatch(/expired|refreshed|changed/i);
  });
});
