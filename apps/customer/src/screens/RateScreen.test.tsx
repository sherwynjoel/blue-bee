import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { OrderStatus } from '@blue-bee/shared';
import type { OrderDetail } from '../api/types';

// useFocusEffect → run on mount like useEffect (no NavigationContainer in the test).
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react') as typeof import('react');
  return { useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => cb(), []) };
});

const mockClient = {
  getOrder: jest.fn(),
  submitRating: jest.fn(),
  updateRating: jest.fn(),
};
const mockMe = { user: { userId: 'u-rita', orgId: 'org', name: 'Rita', phone: null, email: null, roles: [], accountIds: [], siteIds: [] }, org: { id: 'org', name: 'Org' } };
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { RateScreen } from './RateScreen';

const navigation = { navigate: jest.fn(), goBack: jest.fn() } as never;
const route = { params: { orderId: 'order-r1' } } as never;

function deliveredOrder(over: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: 'order-r1',
    orgId: 'org',
    accountId: 'acc',
    pricingAccountId: null,
    pricingAccount: null,
    siteId: null,
    vertical: 'SPECIALTY',
    type: 'JOB',
    status: OrderStatus.DELIVERED,
    heldFrom: null,
    scheduledPickupWindow: null,
    scheduledDeliveryWindow: null,
    totals: { currency: 'CAD' },
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    items: [],
    quotes: [],
    routeStops: [],
    rating: null,
    ...over,
  };
}

describe('RateScreen', () => {
  beforeEach(() => {
    mockClient.getOrder.mockReset();
    mockClient.submitRating.mockReset();
    mockClient.updateRating.mockReset();
    (navigation as { goBack: jest.Mock }).goBack.mockReset();
  });

  it('submits a new rating with the chosen score + comment, keyed idempotently, then returns', async () => {
    mockClient.getOrder.mockResolvedValue(deliveredOrder());
    mockClient.submitRating.mockResolvedValue({ id: 'r1', orderId: 'order-r1', score: 5, comment: 'Great', submittedByUserId: 'u-rita', createdAt: 'x', updatedAt: 'x', editable: true });
    const { findByTestId, getByTestId } = render(<RateScreen navigation={navigation} route={route} />);

    fireEvent.press(await findByTestId('star-5'));
    fireEvent.changeText(getByTestId('rate-comment'), 'Great');
    fireEvent.press(getByTestId('rate-submit'));

    await waitFor(() =>
      expect(mockClient.submitRating).toHaveBeenCalledWith('order-r1', expect.objectContaining({ score: 5, comment: 'Great' }), 'rate-order-r1'),
    );
    await waitFor(() => expect((navigation as { goBack: jest.Mock }).goBack).toHaveBeenCalled());
  });

  it('will not submit until a star is chosen (submit disabled at score 0)', async () => {
    mockClient.getOrder.mockResolvedValue(deliveredOrder());
    const { findByTestId, getByTestId } = render(<RateScreen navigation={navigation} route={route} />);
    await findByTestId('rate-stars');
    fireEvent.press(getByTestId('rate-submit'));
    expect(mockClient.submitRating).not.toHaveBeenCalled();
  });

  it('shows the score read-only when the order is already rated and no longer editable', async () => {
    mockClient.getOrder.mockResolvedValue(
      deliveredOrder({ rating: { id: 'r1', orderId: 'order-r1', score: 4, comment: 'Nice', submittedByUserId: 'u-rita', createdAt: 'x', updatedAt: 'x', editable: false } }),
    );
    const { findByTestId, queryByTestId } = render(<RateScreen navigation={navigation} route={route} />);
    expect(await findByTestId('rate-readonly-score')).toBeTruthy();
    expect(queryByTestId('rate-submit')).toBeNull();
  });

  it('shows a "not ready to rate" state for an order that has not been delivered', async () => {
    mockClient.getOrder.mockResolvedValue(deliveredOrder({ status: OrderStatus.QUOTE_APPROVED }));
    const { findByTestId, queryByTestId } = render(<RateScreen navigation={navigation} route={route} />);
    expect(await findByTestId('rate-not-yet')).toBeTruthy();
    expect(queryByTestId('rate-submit')).toBeNull();
  });
});
