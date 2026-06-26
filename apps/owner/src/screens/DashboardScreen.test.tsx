import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { OwnerTodayResult } from '@blue-bee/shared';

// useFocusEffect → run on mount like useEffect (no NavigationContainer in the test).
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react') as typeof import('react');
  return { useFocusEffect: (cb: () => void) => ReactLib.useEffect(() => cb(), []) };
});

const mockToday = jest.fn();
const mockLogout = jest.fn(async () => undefined);
// A STABLE client ref (mirrors the real app's useRef) — a fresh object each render would change
// useAsync's [client] dep and re-fetch on every render (infinite loop).
const mockClient = { today: mockToday };
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, logout: mockLogout, me: { org: { name: 'Blue Bee GTA' } } }),
}));

import { DashboardScreen } from './DashboardScreen';

jest.setTimeout(30000);

const TODAY: OwnerTodayResult = {
  dayStart: '2026-06-26T04:00:00.000Z',
  generatedAt: '2026-06-26T16:00:00.000Z',
  timezone: 'America/Toronto',
  ordersToday: 5,
  activeOrders: 3,
  completedToday: 2,
  pendingApprovals: 4,
  openExceptions: 1,
  revenueToday: '1000.00',
  collectedToday: '500.00',
  currency: 'CAD',
  onTimePercent: 80,
};

const navigation = { navigate: jest.fn() } as never;

describe('DashboardScreen', () => {
  beforeEach(() => {
    mockToday.mockReset();
    (navigation as { navigate: jest.Mock }).navigate.mockReset();
  });

  it('renders the server-aggregated KPIs (no client math) and the attention counts', async () => {
    mockToday.mockResolvedValue(TODAY);
    const { findByText, getByText } = render(<DashboardScreen navigation={navigation} />);
    await findByText('Orders today');
    expect(getByText('5')).toBeTruthy(); // ordersToday
    expect(getByText('$500.00 CAD')).toBeTruthy(); // collected today
    expect(getByText('80%')).toBeTruthy(); // on-time
    expect(getByText('4')).toBeTruthy(); // pending-approvals count pill
  });

  it('navigates into the feeds', async () => {
    mockToday.mockResolvedValue(TODAY);
    const { findByTestId, getByTestId } = render(<DashboardScreen navigation={navigation} />);
    await findByTestId('nav-approvals');
    fireEvent.press(getByTestId('nav-approvals'));
    await waitFor(() => expect((navigation as { navigate: jest.Mock }).navigate).toHaveBeenCalledWith('Approvals'));
  });

  it('shows an error with retry when the read fails (never a blank screen)', async () => {
    mockToday.mockRejectedValue(new Error('boom'));
    const { findByTestId } = render(<DashboardScreen navigation={navigation} />);
    await findByTestId('error');
  });
});
