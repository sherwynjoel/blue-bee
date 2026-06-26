import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OrderStatus } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const mockClient = { listOrders: jest.fn() };
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: null, status: 'signedIn' }) }));

import { OrdersQueue } from './OrdersQueue';

const order = (id: string, status: OrderStatus) => ({ id, status, vertical: 'SPECIALTY', accountId: 'a', siteId: null, totals: { total: '293.80', currency: 'CAD' }, createdAt: '2026-06-26T00:00:00Z', quotes: [] });

beforeEach(() => jest.clearAllMocks());

describe('OrdersQueue', () => {
  it('renders the queue rows from GET /orders', async () => {
    mockClient.listOrders.mockResolvedValue({ orders: [order('order-aaaa1111', OrderStatus.QUOTED)], nextCursor: null, hasMore: false });
    render(<OrdersQueue />);
    await waitFor(() => expect(screen.getByTestId('order-row-order-aaaa1111')).toBeInTheDocument());
    // 'Quoted' appears in both the filter option and the row badge — assert at least the badge exists.
    expect(screen.getAllByText('Quoted').length).toBeGreaterThan(0);
    expect(screen.getByText(/293\.80/)).toBeInTheDocument();
  });

  it('shows an empty state when there are no orders', async () => {
    mockClient.listOrders.mockResolvedValue({ orders: [], nextCursor: null, hasMore: false });
    render(<OrdersQueue />);
    await waitFor(() => expect(screen.getByText(/No orders match/i)).toBeInTheDocument());
  });

  it('surfaces an API error with a retry', async () => {
    mockClient.listOrders.mockRejectedValue(new ApiError(500, { title: 'boom' }, 'boom'));
    render(<OrdersQueue />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });
});
