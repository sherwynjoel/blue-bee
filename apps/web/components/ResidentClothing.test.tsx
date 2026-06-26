import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';

/**
 * Resident-clothing view (Track-B care homes, A4.2). Proves the four buckets render real-shaped data,
 * the lost & found pool shows pooled garments, reconcile calls the client, and RBAC hides the reconcile
 * action from read-only account staff.
 */
const mockClient = {
  listAccounts: jest.fn(),
  getAccount: jest.fn(),
  listResidents: jest.fn(),
  getResidentClothing: jest.fn(),
  getLostFoundPool: jest.fn(),
  reconcileLostFound: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { ResidentClothing } from './ResidentClothing';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const ACCOUNT = {
  id: 'acct-care',
  name: 'Demo — Maple Grove Care Home',
  type: 'BUSINESS' as never,
  billingMode: 'PER_ORDER' as never,
  billingNetDays: 0,
  siteCount: 1,
  activeStandingOrderCount: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  sites: [{ id: 'site-1', name: 'Maple Grove — West Wing' }],
};
const RESIDENTS = {
  residents: [
    { id: 'r1', siteId: 'site-1', name: 'Demo — Eleanor Whitfield', room: '204', status: 'ACTIVE' as never, createdAt: '2026-06-01T00:00:00.000Z' },
    { id: 'r2', siteId: 'site-1', name: 'Demo — Harold Banks', room: '112', status: 'ACTIVE' as never, createdAt: '2026-06-01T00:00:00.000Z' },
  ],
};
const CLOTHING_R1 = {
  resident: RESIDENTS.residents[0],
  buckets: {
    enrolled: [{ id: 'g1', residentId: 'r1', tagCode: 'RES-204-01', garmentStatus: 'GARMENT_ENROLLED', description: 'Blue knit cardigan', updatedAt: '2026-06-02T00:00:00.000Z' }],
    inProcess: [{ id: 'g2', residentId: 'r1', tagCode: 'RES-204-02', garmentStatus: 'WASH', description: 'Floral day blouse', updatedAt: '2026-06-02T00:00:00.000Z' }],
    returned: [{ id: 'g3', residentId: 'r1', tagCode: 'RES-204-03', garmentStatus: 'DELIVERED_TO_RESIDENT', description: 'Grey wool trousers', updatedAt: '2026-06-02T00:00:00.000Z' }],
    lostFound: [],
  },
};
const POOL = {
  lostFound: [
    { id: 'lf1', siteId: 'site-1', status: 'OPEN', itemId: 'g5', tagCode: 'RES-LF-01', garmentStatus: 'LOST_FOUND_POOL', candidateResidentId: 'r2', candidateResidentName: 'Demo — Harold Banks', notes: 'Tartan wool scarf', reconciledAt: null, createdAt: '2026-06-03T00:00:00.000Z' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.listAccounts.mockResolvedValue({ accounts: [{ id: 'acct-care', name: 'Demo — Maple Grove Care Home', type: 'BUSINESS', billingMode: 'PER_ORDER', billingNetDays: 0, siteCount: 1, activeStandingOrderCount: 0 }], nextCursor: null, hasMore: false });
  mockClient.getAccount.mockResolvedValue(ACCOUNT);
  mockClient.listResidents.mockResolvedValue(RESIDENTS);
  mockClient.getResidentClothing.mockResolvedValue(CLOTHING_R1);
  mockClient.getLostFoundPool.mockResolvedValue(POOL);
  mockClient.reconcileLostFound.mockResolvedValue({ id: 'g5', residentId: 'r2', tagCode: 'RES-LF-01', garmentStatus: 'RECONCILE', description: null, updatedAt: '2026-06-04T00:00:00.000Z' });
});

describe('ResidentClothing (A4.2 view)', () => {
  it('renders the four buckets for the default resident + the lost & found pool', async () => {
    render(<ResidentClothing />);
    await waitFor(() => expect(mockClient.getResidentClothing).toHaveBeenCalledWith('r1'));

    // Buckets render with the real garments.
    expect(within(await screen.findByTestId('bucket-enrolled')).getByText('Blue knit cardigan')).toBeInTheDocument();
    expect(within(screen.getByTestId('bucket-inProcess')).getByText('Floral day blouse')).toBeInTheDocument();
    expect(within(screen.getByTestId('bucket-returned')).getByText('Grey wool trousers')).toBeInTheDocument();
    // Lost & found pool.
    expect(mockClient.getLostFoundPool).toHaveBeenCalledWith('site-1');
    expect(await screen.findByTestId('lostfound-lf1')).toBeInTheDocument();
    expect(screen.getByText('Tartan wool scarf')).toBeInTheDocument();
  });

  it('loads another resident\'s clothing when selected', async () => {
    mockClient.getResidentClothing.mockImplementation((id: string) =>
      Promise.resolve(id === 'r2' ? { resident: RESIDENTS.residents[1], buckets: { enrolled: [], inProcess: [], returned: [], lostFound: [] } } : CLOTHING_R1),
    );
    render(<ResidentClothing />);
    await screen.findByTestId('resident-r2');
    fireEvent.click(screen.getByTestId('resident-r2'));
    await waitFor(() => expect(mockClient.getResidentClothing).toHaveBeenCalledWith('r2'));
  });

  it('reconciles a pooled garment to a resident via the client', async () => {
    render(<ResidentClothing />);
    const row = await screen.findByTestId('lostfound-lf1');
    fireEvent.change(within(row).getByLabelText('Reconcile lf1 to'), { target: { value: 'r1' } });
    fireEvent.click(within(row).getByText('Reconcile'));
    await waitFor(() => expect(mockClient.reconcileLostFound).toHaveBeenCalledWith('lf1', { residentId: 'r1' }));
  });

  it('RBAC: read-only account staff see the pool but NO reconcile action', async () => {
    mockMe = me(RoleType.ACCOUNT_STAFF);
    render(<ResidentClothing />);
    const row = await screen.findByTestId('lostfound-lf1');
    expect(within(row).queryByText('Reconcile')).not.toBeInTheDocument();
  });
});
