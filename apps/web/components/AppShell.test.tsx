import React from 'react';
import { render, screen } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';

let session: { status: string; me: MeResponse | null; logout: jest.Mock };
jest.mock('@/lib/session', () => ({ useSession: () => session }));

import { AppShell } from './AppShell';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Sam', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Acme Laundry' } };
}

beforeEach(() => {
  session = { status: 'signedIn', me: me(RoleType.OWNER), logout: jest.fn() };
});

describe('AppShell (RBAC gate)', () => {
  it('renders the nav + children for an ops role', () => {
    render(<AppShell><div data-testid="child">hi</div></AppShell>);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Acme Laundry')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows the finance nav only to finance roles', () => {
    session.me = me(RoleType.CSR);
    render(<AppShell><div /></AppShell>);
    expect(screen.queryByText('Finance')).not.toBeInTheDocument();
    session.me = me(RoleType.FINANCE);
    const { getByText } = render(<AppShell><div /></AppShell>);
    expect(getByText('Finance')).toBeInTheDocument();
  });

  it('denies a customer-only token (no ops role) with a clear notice', () => {
    session.me = me(RoleType.RESIDENTIAL_CUSTOMER);
    render(<AppShell><div data-testid="child">secret</div></AppShell>);
    expect(screen.getByText(/No console access/i)).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('shows the login when signed out', () => {
    session = { status: 'signedOut', me: null, logout: jest.fn() };
    render(<AppShell><div /></AppShell>);
    expect(screen.getByText(/Operator sign-in/i)).toBeInTheDocument();
  });
});
