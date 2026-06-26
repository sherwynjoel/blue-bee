import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { OwnerException } from '@blue-bee/shared';

jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react') as typeof import('react');
  return { useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => cb(), []) };
});

const mockExceptions = jest.fn();
// A STABLE client ref (mirrors the real app's useRef) — see DashboardScreen.test for why.
const mockClient = { exceptions: mockExceptions };
jest.mock('../session/SessionProvider', () => ({ useSession: () => ({ client: mockClient }) }));

import { ExceptionsScreen } from './ExceptionsScreen';

jest.setTimeout(30000);

const navigation = { navigate: jest.fn() } as never;

const HELD: OwnerException = {
  id: 'order-1',
  kind: 'ORDER_HELD',
  title: 'Order on hold — Acme',
  detail: 'Paused from IN_CLEANING',
  orderId: 'order-1',
  routeId: null,
  stopId: null,
  amount: null,
  currency: null,
  occurredAt: '2026-06-26T12:00:00.000Z',
};
const STOP_FAILED: OwnerException = {
  id: 'stop-1',
  kind: 'STOP_FAILED',
  title: 'Stop failed — City Hall',
  detail: 'customer not home',
  orderId: 'order-2',
  routeId: 'route-9',
  stopId: 'stop-1',
  amount: null,
  currency: null,
  occurredAt: '2026-06-26T11:00:00.000Z',
};

describe('ExceptionsScreen', () => {
  beforeEach(() => {
    mockExceptions.mockReset();
    (navigation as { navigate: jest.Mock }).navigate.mockReset();
  });

  it('renders the feed and deep-links a held order to its order detail', async () => {
    mockExceptions.mockResolvedValue({ exceptions: [HELD, STOP_FAILED] });
    const { findByTestId, getByTestId } = render(<ExceptionsScreen navigation={navigation} />);
    await findByTestId('exception-order-1');
    fireEvent.press(getByTestId('exception-order-1'));
    await waitFor(() => expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('OrderDetail', { orderId: 'order-1' }));
  });

  it('deep-links a failed stop to its route (drill-through)', async () => {
    mockExceptions.mockResolvedValue({ exceptions: [STOP_FAILED] });
    const { findByTestId, getByTestId } = render(<ExceptionsScreen navigation={navigation} />);
    await findByTestId('exception-stop-1');
    fireEvent.press(getByTestId('exception-stop-1'));
    await waitFor(() =>
      expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('RouteDetail', { routeId: 'route-9', title: 'Stop exception' }),
    );
  });

  it('shows an empty state when there are no exceptions', async () => {
    mockExceptions.mockResolvedValue({ exceptions: [] });
    const { findByTestId } = render(<ExceptionsScreen navigation={navigation} />);
    await findByTestId('exceptions-empty');
  });
});
