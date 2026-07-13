import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { OrderStatus, type HomeView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const mockGetHome = jest.fn<Promise<HomeView>, []>();
const mockClient = { getHome: mockGetHome };
jest.mock('../session/SessionProvider', () => ({
  useSession: () => ({ client: mockClient, me: { user: { name: 'Rita Patel' } } }),
}));

const mockNavigate = jest.fn();
const mockAddListener = jest.fn((_e: string, _h: () => void) => jest.fn());
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, addListener: mockAddListener }),
}));

import { DashboardScreen } from './DashboardScreen';

jest.setTimeout(30000);

/** A Home payload with NO funded reward + no credit — the honest default state. */
const home = (over: Partial<HomeView> = {}): HomeView => ({
  blocks: [],
  credits: { balance: '0.00', currency: 'CAD', entries: [] },
  reward: { enabled: false, amount: null, currency: 'CAD', earnedWhen: 'referred_friend_first_order_delivered' },
  recentOrders: [],
  orderCount: 0,
  account: { name: 'Rita Patel', email: 'rita@bluebee.example', phone: '+14165550010', referralCode: 'ABCD2345' },
  ...over,
});

const REFER_BLOCK = {
  id: 'b1',
  kind: 'ANNOUNCEMENT' as const,
  title: 'Invite your family & friends',
  body: 'Share your code with the people you know.',
  ctaLabel: 'Invite',
  ctaTarget: 'refer' as const,
  sortOrder: 0,
};

beforeEach(() => {
  mockGetHome.mockReset();
  mockNavigate.mockReset();
  mockAddListener.mockClear();
});

describe('DashboardScreen — the Home tab (Inc-37)', () => {
  it('renders the founder’s "what’s new" card, my orders and my account — all from the server', async () => {
    mockGetHome.mockResolvedValue(
      home({
        blocks: [REFER_BLOCK],
        recentOrders: [{ id: 'order-abc12345', status: OrderStatus.DELIVERED, createdAt: '2026-07-01T10:00:00.000Z', total: '30.74', currency: 'CAD' }],
        orderCount: 4,
      }),
    );
    const { findByTestId, getByText } = render(<DashboardScreen />);

    // 1. What's new — the founder's copy, not the app's.
    await findByTestId('home-block-b1');
    getByText('Invite your family & friends');
    // 2. My orders — a real order.
    await findByTestId('home-order-order-abc12345');
    getByText('See all (4)');
    // 3. My account — real identity + their invite code.
    await findByTestId('home-account-row');
    getByText('Rita Patel');
  });

  // ─────────────────────────── the honesty firewall ───────────────────────────

  it('with NO funded reward it promises NOTHING — no reward terms, no credit balance row', async () => {
    // A founder can write whatever they like in a block; the app still cannot conjure a reward.
    mockGetHome.mockResolvedValue({
      ...home({ blocks: [{ ...REFER_BLOCK, body: 'Invite friends!' }] }),
    });
    const { findByTestId, queryByTestId, queryAllByText } = render(<DashboardScreen />);
    await findByTestId('home-block-b1');

    // The reward line + the credit balance simply do not exist — no "0 credits" stub, no hollow promise.
    expect(queryByTestId('home-reward-terms')).toBeNull();
    expect(queryByTestId('home-credit-balance')).toBeNull();
    // And nothing rendered anywhere implies a reward or an amount.
    expect(queryAllByText(/free credit|credits|earn|\$\d/i)).toHaveLength(0);
  });

  it('once the founder FUNDS the reward, the terms are stated exactly — from config, not from the block text', async () => {
    mockGetHome.mockResolvedValue(
      home({
        blocks: [REFER_BLOCK],
        reward: { enabled: true, amount: '10.00', currency: 'CAD', earnedWhen: 'referred_friend_first_order_delivered' },
      }),
    );
    const { findByTestId } = render(<DashboardScreen />);
    const terms = await findByTestId('home-reward-terms');
    // The exact, honest condition — never a vague "get free credits".
    expect(String(terms.props.children)).toContain('$10.00');
    expect(String(terms.props.children)).toMatch(/first order delivered/i);
  });

  it('shows the REAL credit balance when the customer holds one', async () => {
    mockGetHome.mockResolvedValue(
      home({
        credits: { balance: '30.00', currency: 'CAD', entries: [] },
        reward: { enabled: true, amount: '10.00', currency: 'CAD', earnedWhen: 'referred_friend_first_order_delivered' },
      }),
    );
    const { findByTestId } = render(<DashboardScreen />);
    expect(String((await findByTestId('home-credit-balance')).props.children)).toContain('30.00');
  });

  // ─────────────────────────── behaviour ───────────────────────────

  it('a block’s CTA routes to the tab its target names (never a raw route from the console)', async () => {
    mockGetHome.mockResolvedValue(home({ blocks: [REFER_BLOCK] }));
    const { findByTestId } = render(<DashboardScreen />);
    fireEvent.press(await findByTestId('home-block-cta-b1'));
    expect(mockNavigate).toHaveBeenCalledWith('Refer');
  });

  it('with no orders it points the customer at the Services grid', async () => {
    mockGetHome.mockResolvedValue(home());
    const { findByTestId, getByText } = render(<DashboardScreen />);
    await findByTestId('home-no-orders');
    fireEvent.press(getByText('Choose a service'));
    expect(mockNavigate).toHaveBeenCalledWith('Services');
  });

  it('re-reads on tab focus and pull-to-refresh, so a console edit reaches an OPEN app', async () => {
    mockGetHome.mockResolvedValue(home());
    const { findByTestId, getByTestId } = render(<DashboardScreen />);
    await findByTestId('dashboard-scroll');
    expect(mockGetHome).toHaveBeenCalledTimes(1);

    // focus (the first focus is skipped — mount already loaded)
    const handler = mockAddListener.mock.calls.find(([e]) => e === 'focus')?.[1];
    handler!();
    await act(async () => {
      handler!();
    });
    expect(mockGetHome).toHaveBeenCalledTimes(2);

    await act(async () => {
      getByTestId('dashboard-scroll').props.refreshControl.props.onRefresh();
    });
    expect(mockGetHome).toHaveBeenCalledTimes(3);
  });

  it('a failed refresh keeps the Home on screen (never blanks working content)', async () => {
    mockGetHome.mockResolvedValue(home({ blocks: [REFER_BLOCK] }));
    const { findByTestId, getByTestId, queryByTestId } = render(<DashboardScreen />);
    await findByTestId('home-block-b1');

    mockGetHome.mockRejectedValue(new ApiError(500, { error: 'server_error' }, 'offline'));
    await act(async () => {
      getByTestId('dashboard-scroll').props.refreshControl.props.onRefresh();
    });
    expect(getByTestId('home-block-b1')).toBeTruthy();
    expect(queryByTestId('dashboard-retry')).toBeNull();
  });

  it('surfaces a cold-load failure with a retry', async () => {
    mockGetHome.mockRejectedValue(new ApiError(500, { error: 'server_error' }, 'Server error'));
    const { findByTestId } = render(<DashboardScreen />);
    expect(await findByTestId('dashboard-retry')).toBeTruthy();
  });
});
