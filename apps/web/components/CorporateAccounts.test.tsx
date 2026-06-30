import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { RoleType, type CorporateAccountsResult, type CorporateBuildingsResult, type CorporateAccountView, type RateCardView, type MeResponse } from '@blue-bee/shared';

const mockClient = {
  listCorporateAccounts: jest.fn(),
  createCorporateAccount: jest.fn(),
  getCorporateAccount: jest.fn(),
  listCorporateBuildings: jest.fn(),
  getRateCard: jest.fn(),
  setRateCardItem: jest.fn(),
  generateJoinCode: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { CorporateHome, CorporateDetail } from './CorporateAccounts';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const accounts: CorporateAccountsResult = {
  accounts: [
    { id: 'corp-1', name: 'Maple District Towers', type: 'BUSINESS' as never, billingMode: 'PER_ORDER' as never, corporate: true, joinCode: 'MAPLELOFT', joinCodeExpiresAt: null, buildingCount: 2, memberCount: 5, createdAt: '2026-06-30T00:00:00.000Z' },
  ],
};
const account: CorporateAccountView = accounts.accounts[0];
const buildings: CorporateBuildingsResult = {
  buildings: [{ id: 'bldg-1', accountId: 'corp-1', name: 'Tower 1', address: '200 Bay St', geo: { lat: 43.6489, lng: -79.3801 }, matchRadiusM: 300, createdAt: '2026-06-30T00:00:00.000Z' }],
};
const rateCard: RateCardView = {
  accountId: 'corp-1',
  priceListId: 'pl-1',
  currency: 'CAD',
  items: [
    { serviceId: 'svc-lb', serviceName: 'Wash & fold', unit: 'LB' as never, accountRate: '1.8000', defaultRate: '2.5000', baseRate: '2.5000', effectiveRate: '1.8000', source: 'account_list' },
    { serviceId: 'svc-item', serviceName: 'Dry clean', unit: 'ITEM' as never, accountRate: null, defaultRate: null, baseRate: '12.0000', effectiveRate: '12.0000', source: 'service_base' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.FINANCE);
  mockClient.listCorporateAccounts.mockResolvedValue(accounts);
  mockClient.createCorporateAccount.mockResolvedValue(account);
  mockClient.getCorporateAccount.mockResolvedValue(account);
  mockClient.listCorporateBuildings.mockResolvedValue(buildings);
  mockClient.getRateCard.mockResolvedValue(rateCard);
  mockClient.setRateCardItem.mockResolvedValue(rateCard.items[0]);
  mockClient.generateJoinCode.mockResolvedValue({ accountId: 'corp-1', joinCode: 'NEWCODE1', joinCodeExpiresAt: null });
});

describe('CorporateHome (directory + create, RBAC-gated)', () => {
  it('renders the corporate accounts with building/member counts + join code, linking to detail', async () => {
    render(<CorporateHome />);
    await waitFor(() => expect(mockClient.listCorporateAccounts).toHaveBeenCalled());
    const row = screen.getByTestId('corp-corp-1');
    expect(within(row).getByText('Maple District Towers')).toBeInTheDocument();
    expect(within(row).getByText('MAPLELOFT')).toBeInTheDocument();
    expect(within(row).getByText('Maple District Towers').closest('a')).toHaveAttribute('href', '/corporate/corp-1');
  });

  it('FINANCE can create a corporate account (calls the API with the typed name)', async () => {
    render(<CorporateHome />);
    await waitFor(() => expect(screen.getByTestId('corp-create-form')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Maple District Towers/), { target: { value: 'New Corp' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    await waitFor(() => expect(mockClient.createCorporateAccount).toHaveBeenCalledWith({ name: 'New Corp' }));
  });

  it('RBAC (UX): a member role gets a no-access notice and never fetches corporate accounts', async () => {
    mockMe = me(RoleType.RESIDENTIAL_CUSTOMER);
    render(<CorporateHome />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.listCorporateAccounts).not.toHaveBeenCalled();
  });
});

describe('CorporateDetail (rate-card editor + buildings + join code)', () => {
  it('shows the resolved rate + source per service, and saving a rate calls the API', async () => {
    render(<CorporateDetail accountId="corp-1" />);
    await waitFor(() => expect(mockClient.getRateCard).toHaveBeenCalled());

    const lbRow = screen.getByTestId('rate-svc-lb');
    expect(within(lbRow).getByTestId('resolved-svc-lb')).toHaveTextContent('1.8000');
    expect(within(lbRow).getByTestId('resolved-svc-lb')).toHaveTextContent(/Account list/i);
    // The per-item service falls back to base (no corporate override yet).
    expect(within(screen.getByTestId('rate-svc-item')).getByTestId('resolved-svc-item')).toHaveTextContent('12.0000');

    // Edit the per-pound rate and save → PUT with the numeric rate.
    fireEvent.change(within(lbRow).getByLabelText('Wash & fold rate'), { target: { value: '2.0000' } });
    fireEvent.click(within(lbRow).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockClient.setRateCardItem).toHaveBeenCalledWith('corp-1', 'svc-lb', { rate: 2 }));
  });

  it('renders the building with its geo point + radius, and shows the join code', async () => {
    render(<CorporateDetail accountId="corp-1" />);
    await waitFor(() => expect(mockClient.listCorporateBuildings).toHaveBeenCalled());
    const bRow = screen.getByTestId('corp-building-bldg-1');
    expect(within(bRow).getByText('Tower 1')).toBeInTheDocument();
    expect(within(bRow).getByText('200 Bay St')).toBeInTheDocument();
    expect(within(bRow).getByText('300')).toBeInTheDocument();
    expect(screen.getByTestId('corp-join-code')).toHaveTextContent('MAPLELOFT');
  });
});
