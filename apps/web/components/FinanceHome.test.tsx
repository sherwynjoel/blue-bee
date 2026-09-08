import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { RoleType, type DisputeView, type MeResponse } from '@blue-bee/shared';

const mockClient = { listDisputes: jest.fn(async () => [] as DisputeView[]) };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { FinanceHome } from './FinanceHome';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Fin', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}

function dispute(over: Partial<DisputeView> = {}): DisputeView {
  return {
    id: 'dp1',
    paymentId: 'pay-1',
    orderId: 'order-12345678',
    amount: '75.00',
    currency: 'CAD',
    status: 'OPEN',
    reason: 'fraudulent',
    openedAt: '2026-07-10T10:00:00.000Z',
    resolvedAt: null,
    ...over,
  };
}

// `useRouter()` returns the same shared mock instance every call (see jest.setup.ts) — pull its `push`
// jest.fn() so the order-lookup and dispute-row navigation can be asserted.
const push = (useRouter() as unknown as { push: jest.Mock }).push;

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.FINANCE);
  mockClient.listDisputes.mockResolvedValue([]);
});

describe('FinanceHome', () => {
  it('renders the disputes list from the mocked client call', async () => {
    mockClient.listDisputes.mockResolvedValue([dispute()]);
    render(<FinanceHome />);
    const row = await screen.findByTestId('dispute-dp1');
    expect(within(row).getByText('$75.00 CAD')).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(within(row).getByText('fraudulent')).toBeInTheDocument();
    expect(mockClient.listDisputes).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there are no open disputes', async () => {
    render(<FinanceHome />);
    await waitFor(() => expect(screen.getByText('No open disputes')).toBeInTheDocument());
  });

  it('opens an order by id via the lookup form', async () => {
    render(<FinanceHome />);
    await waitFor(() => expect(screen.getByLabelText('Order id')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Order id'), { target: { value: '  order-abc  ' } });
    fireEvent.click(screen.getByText('Open'));

    expect(push).toHaveBeenCalledWith('/finance/order-abc');
  });

  it('does not navigate on submit when the order id is blank', async () => {
    render(<FinanceHome />);
    await waitFor(() => expect(screen.getByLabelText('Order id')).toBeInTheDocument());
    expect(screen.getByText('Open')).toBeDisabled();
    expect(push).not.toHaveBeenCalled();
  });

  it('clicking a dispute row navigates to that order’s finance page', async () => {
    mockClient.listDisputes.mockResolvedValue([dispute()]);
    render(<FinanceHome />);
    await waitFor(() => expect(screen.getByTestId('dispute-dp1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('#order-12'));
    expect(push).toHaveBeenCalledWith('/finance/order-12345678');
  });

  it('a role WITHOUT finance capability (CSR) is blocked — no request is made', async () => {
    mockMe = me(RoleType.CSR);
    render(<FinanceHome />);
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
    expect(mockClient.listDisputes).not.toHaveBeenCalled();
  });

  it('a role WITH finance capability (OWNER) can view the screen', async () => {
    mockMe = me(RoleType.OWNER);
    render(<FinanceHome />);
    await waitFor(() => expect(mockClient.listDisputes).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/don’t have access/i)).not.toBeInTheDocument();
  });
});
