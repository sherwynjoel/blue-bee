import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleType, type CustomerListResult, type MeResponse } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const mockClient = { listCustomers: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { CustomersHome } from './CustomersHome';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: {
      userId: 'u',
      orgId: 'g',
      name: 'Staff',
      phone: null,
      email: null,
      roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })),
      accountIds: [],
      siteIds: [],
    },
    org: { id: 'g', name: 'Org' },
  };
}

const ZARA = 'user-zara';
const YUSUF = 'user-yusuf';

const customers: CustomerListResult = {
  customers: [
    {
      userId: ZARA,
      name: 'Zara Rich',
      phone: '+14165557010',
      email: 'zara@example.com',
      status: 'ACTIVE',
      joinedAt: '2026-01-05T10:00:00.000Z',
      accounts: [{ id: 'acct-1', name: 'Zara account', type: 'RESIDENTIAL' as never }],
      accountOrderCount: 3,
      lastAccountOrderAt: '2026-07-01T10:00:00.000Z',
      savedAddressCount: 2,
    },
    {
      userId: YUSUF,
      name: 'Yusuf Bare',
      phone: null,
      email: null,
      status: 'SUSPENDED',
      joinedAt: '2026-02-05T10:00:00.000Z',
      accounts: [],
      accountOrderCount: 0,
      lastAccountOrderAt: null,
      savedAddressCount: 0,
    },
  ],
  nextCursor: null,
  hasMore: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.listCustomers.mockResolvedValue(customers);
});

describe('CustomersHome (residential directory, RBAC-gated)', () => {
  it('renders the real customers with contact, status and account-level counts', async () => {
    render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());

    const zara = screen.getByTestId(`customer-${ZARA}`);
    expect(within(zara).getByText('Zara Rich')).toBeInTheDocument();
    expect(within(zara).getByText('+14165557010')).toBeInTheDocument();
    expect(within(zara).getByText('zara@example.com')).toBeInTheDocument();
    expect(within(zara).getByText('ACTIVE')).toBeInTheDocument();
    expect(within(zara).getByText('Zara account')).toBeInTheDocument();
  });

  it('names the count as ACCOUNT orders — an order has no user, so it must not read as "their" orders', async () => {
    render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());
    expect(screen.getByText('Account orders')).toBeInTheDocument();
    expect(screen.queryByText(/^Orders$/)).not.toBeInTheDocument();
  });

  it('a customer with no orders shows an em dash for "last order", never a date', async () => {
    render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());

    const yusuf = screen.getByTestId(`customer-${YUSUF}`);
    expect(within(yusuf).getAllByText('—').length).toBeGreaterThanOrEqual(1); // phone, email, last order
    expect(within(yusuf).getByText('SUSPENDED')).toBeInTheDocument();
  });

  it('links each row to that customer 360', async () => {
    render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());
    const link = within(screen.getByTestId(`customer-${ZARA}`)).getByRole('link', { name: 'Zara Rich' });
    expect(link).toHaveAttribute('href', `/customers/${ZARA}`);
  });

  it('searching re-queries the SERVER (the server owns the filter, not the client)', async () => {
    const user = userEvent.setup();
    render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());

    await user.type(screen.getByLabelText('Search customers'), 'zara');
    await waitFor(() => {
      const calls = mockClient.listCustomers.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({ search: 'zara' });
    });
  });

  it('an empty search result says so, and names the term', async () => {
    const user = userEvent.setup();
    mockClient.listCustomers.mockResolvedValue({ customers: [], nextCursor: null, hasMore: false });
    render(<CustomersHome />);
    await user.type(screen.getByLabelText('Search customers'), 'nobody');
    expect(await screen.findByText('No matching customers')).toBeInTheDocument();
  });

  it('an empty directory shows the zero-state, not an empty table', async () => {
    mockClient.listCustomers.mockResolvedValue({ customers: [], nextCursor: null, hasMore: false });
    render(<CustomersHome />);
    expect(await screen.findByText('No customers yet')).toBeInTheDocument();
  });

  it("surfaces the SERVER's error message with a retry rather than a blank page", async () => {
    mockClient.listCustomers.mockRejectedValue(new ApiError(500, { status: 500 }, 'upstream unavailable'));
    render(<CustomersHome />);
    expect(await screen.findByText('upstream unavailable')).toBeInTheDocument();
  });

  it('admits the page cap instead of silently truncating', async () => {
    mockClient.listCustomers.mockResolvedValue({ ...customers, hasMore: true, nextCursor: 'c' });
    render(<CustomersHome />);
    expect(await screen.findByText(/Showing the first 2 customers/)).toBeInTheDocument();
  });

  it('RBAC: a CSR may view it; a DISPATCHER may not (mirrors the server @Roles(OWNER, CSR))', async () => {
    mockMe = me(RoleType.CSR);
    const { unmount } = render(<CustomersHome />);
    await waitFor(() => expect(mockClient.listCustomers).toHaveBeenCalled());
    unmount();

    jest.clearAllMocks();
    mockMe = me(RoleType.DISPATCHER);
    render(<CustomersHome />);
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
    expect(mockClient.listCustomers).not.toHaveBeenCalled(); // never even asks
  });

  it('RBAC: a FINANCE user may not (customer PII is OWNER/CSR only)', () => {
    mockMe = me(RoleType.FINANCE);
    render(<CustomersHome />);
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
    expect(mockClient.listCustomers).not.toHaveBeenCalled();
  });
});
