import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { RoleType, type AccountListResult, type MeResponse } from '@blue-bee/shared';

const mockClient = { listAccounts: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { AccountsHome } from './AccountsHome';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const accounts: AccountListResult = {
  accounts: [
    { id: 'acct-b', name: 'Harbourview Condos', type: 'BUSINESS' as never, billingMode: 'BATCH_PERIODIC' as never, billingNetDays: 30, siteCount: 2, activeStandingOrderCount: 1 },
    { id: 'acct-a', name: 'Rita (residential)', type: 'RESIDENTIAL' as never, billingMode: 'PER_ORDER' as never, billingNetDays: 0, siteCount: 4, activeStandingOrderCount: 0 },
  ],
  nextCursor: null,
  hasMore: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.listAccounts.mockResolvedValue(accounts);
});

describe('AccountsHome (B2B directory, RBAC-gated)', () => {
  it('renders the real accounts with their billing terms + counts', async () => {
    render(<AccountsHome />);
    await waitFor(() => expect(mockClient.listAccounts).toHaveBeenCalled());

    const bRow = screen.getByTestId('account-acct-b');
    expect(within(bRow).getByText('Harbourview Condos')).toBeInTheDocument();
    expect(within(bRow).getByText('Business')).toBeInTheDocument();
    expect(within(bRow).getByText('Batch Periodic')).toBeInTheDocument();
    expect(within(bRow).getByText('30')).toBeInTheDocument(); // net days
    expect(within(bRow).getByText('1')).toBeInTheDocument(); // active standing orders

    const aRow = screen.getByTestId('account-acct-a');
    expect(within(aRow).getByText('Per Order')).toBeInTheDocument();
    expect(within(aRow).getByText('—')).toBeInTheDocument(); // PER_ORDER → no net days
  });

  it('links each account to its detail page', async () => {
    render(<AccountsHome />);
    await waitFor(() => expect(screen.getByText('Harbourview Condos')).toBeInTheDocument());
    expect(screen.getByText('Harbourview Condos').closest('a')).toHaveAttribute('href', '/accounts/acct-b');
  });

  it('RBAC (UX): a non-accounts role gets a no-access notice and no fetch', async () => {
    mockMe = me(RoleType.RESIDENTIAL_CUSTOMER);
    render(<AccountsHome />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.listAccounts).not.toHaveBeenCalled();
  });

  it('surfaces a load error with a retry', async () => {
    mockClient.listAccounts.mockRejectedValue(new Error('boom'));
    render(<AccountsHome />);
    await waitFor(() => expect(screen.getByText('Try again')).toBeInTheDocument());
  });
});
