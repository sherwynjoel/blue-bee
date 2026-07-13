import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { RoleType, type Customer360View, type MeResponse } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

// [Inc-37] The 360 now renders the credit ledger, which reads its own endpoint.
const mockGetCredits = jest.fn(async () => ({ balance: '0.00', currency: 'CAD', entries: [] as unknown[] }));
const mockAdjustCredits = jest.fn();
const mockClient = { getCustomer360: jest.fn(), getCustomerCredits: mockGetCredits, adjustCustomerCredits: mockAdjustCredits };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { CustomerDetail } from './CustomerDetail';

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

const USER_ID = 'user-zara';
const SITE_HOME = 'site-home';
const SITE_COTTAGE = 'site-cottage';
const SITE_NOPIN = 'site-nopin';

function view(over: Partial<Customer360View> = {}): Customer360View {
  return {
    customer: {
      userId: USER_ID,
      name: 'Zara Rich',
      phone: '+14165557010',
      email: 'zara@example.com',
      status: 'ACTIVE',
      joinedAt: '2026-01-05T10:00:00.000Z',
      authProviders: ['phone'],
      roles: [{ role: RoleType.RESIDENTIAL_CUSTOMER, scope: 'ACCOUNT', scopeId: 'acct-1' }],
    },
    referral: { code: 'ZARA2345', referredBy: null, referralsMadeCount: 0 },
    accounts: [{ id: 'acct-1', name: 'Zara account', type: 'RESIDENTIAL' as never }],
    addresses: [
      {
        id: SITE_HOME,
        accountId: 'acct-1',
        name: 'Home',
        address: '100 Queen St W',
        unit: '12B',
        buzzer: '1204',
        notes: 'Side door',
        isDefault: true,
        geo: { lng: -79.38, lat: 43.65 },
        serviceability: { checked: true, serviceable: true, coverageRequestId: null },
      },
      {
        id: SITE_COTTAGE,
        accountId: 'acct-1',
        name: 'Cottage',
        address: '111 Wellington St, Ottawa',
        unit: null,
        buzzer: null,
        notes: null,
        isDefault: false,
        geo: { lng: -75.69, lat: 45.42 },
        serviceability: { checked: true, serviceable: false, coverageRequestId: null },
      },
    ],
    orders: [
      { id: 'order-1', accountId: 'acct-1', siteId: SITE_HOME, status: 'INVOICED', vertical: 'SPECIALTY', total: '158.20', currency: 'CAD', createdAt: '2026-07-01T10:00:00.000Z', bookedByThisCustomer: true },
      { id: 'order-2', accountId: 'acct-1', siteId: null, status: 'REQUESTED', vertical: 'SPECIALTY', total: null, currency: 'CAD', createdAt: '2026-06-01T10:00:00.000Z', bookedByThisCustomer: false },
      { id: 'order-3', accountId: 'acct-1', siteId: null, status: 'REQUESTED', vertical: 'SPECIALTY', total: null, currency: 'CAD', createdAt: '2026-05-01T10:00:00.000Z', bookedByThisCustomer: null },
    ],
    accountOrderCount: 3,
    invoices: [{ id: 'inv-1', number: 'INV-1', status: 'ISSUED', total: '158.20', currency: 'CAD', issuedAt: '2026-07-02T10:00:00.000Z', orderId: 'order-1' }],
    payments: [{ id: 'pay-1', status: 'SUCCEEDED', method: 'CARD', amount: '158.20', currency: 'CAD', createdAt: '2026-07-02T11:00:00.000Z', orderId: 'order-1', invoiceId: 'inv-1' }],
    devices: [{ id: 'dev-1', platform: 'IOS' as never, pushTokenMasked: '…9876', lastSeen: '2026-07-05T10:00:00.000Z', createdAt: '2026-01-05T10:00:00.000Z' }],
    memberships: [],
    notifications: { configured: false, pushEnabled: true, smsEnabled: true, emailEnabled: true, quietHoursStart: null, quietHoursEnd: null, timezone: 'America/Toronto' },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.getCustomer360.mockResolvedValue(view());
});

describe('CustomerDetail (consumer 360)', () => {
  it('renders identity, contact and the account', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getByRole('heading', { name: 'Zara Rich' })).toBeInTheDocument();
    expect(screen.getByText('+14165557010')).toBeInTheDocument();
    expect(screen.getByText('zara@example.com')).toBeInTheDocument();
    expect(screen.getByText('Zara account')).toBeInTheDocument();
  });

  it('[Inc-34] shows referral attribution (code · referred-by · referrals-made) with NO reward copy', async () => {
    mockClient.getCustomer360.mockResolvedValue(
      view({ referral: { code: 'ZARA2345', referredBy: { userId: 'ref-u', name: 'Priya Nair' }, referralsMadeCount: 3 } }),
    );
    render(<CustomerDetail userId={USER_ID} />);
    const referral = await screen.findByTestId('referral');
    expect(within(referral).getByText('ZARA2345')).toBeInTheDocument();
    expect(within(referral).getByText('Priya Nair')).toBeInTheDocument(); // referred by
    expect(within(referral).getByText('3')).toBeInTheDocument(); // referrals made
    // Honesty firewall: the referral surface shows the invite GRAPH, never a reward/credit (none exists).
    expect(referral.textContent).not.toMatch(/reward|credit|earn|\$/i);
  });

  it('[Inc-37] shows the REAL credit balance + the append-only ledger', async () => {
    mockGetCredits.mockResolvedValue({
      balance: '30.00',
      currency: 'CAD',
      entries: [
        { id: 'c1', kind: 'REFERRAL_EARN', amount: '10.00', currency: 'CAD', orderId: null, referredName: 'Priya Nair', note: null, createdAt: '2026-07-01T10:00:00.000Z' },
        { id: 'c2', kind: 'REDEMPTION', amount: '-10.00', currency: 'CAD', orderId: 'order-1', referredName: null, note: 'Credit applied to this order', createdAt: '2026-07-02T10:00:00.000Z' },
      ] as never,
    });
    render(<CustomerDetail userId={USER_ID} />);
    const balance = await screen.findByTestId('credit-balance');
    expect(balance.textContent).toContain('30.00');
    // Both a grant and a spend are shown — the ledger, not a stored counter.
    expect(await screen.findByTestId('credit-entry-c1')).toBeInTheDocument();
    expect(screen.getByTestId('credit-entry-c2')).toBeInTheDocument();
    expect(screen.getByTestId('credit-entry-c1').textContent).toContain('Priya Nair');
  });

  // ── the honesty firewall, rendered ──

  it('coverage: "In service area" only when the server actually checked AND it is covered', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(within(screen.getByTestId(`address-${SITE_HOME}`)).getByText('In service area')).toBeInTheDocument();
    expect(within(screen.getByTestId(`address-${SITE_COTTAGE}`)).getByText('Outside service area')).toBeInTheDocument();
  });

  it('coverage: with NO active zones the badge says "not checked" — never "Outside service area"', async () => {
    // An inert gate is not evidence of anything. Calling it "outside" would be a fabricated claim.
    const v = view();
    v.addresses = v.addresses.map((a) => ({ ...a, serviceability: { checked: false, serviceable: false, coverageRequestId: null } }));
    mockClient.getCustomer360.mockResolvedValue(v);

    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getAllByText('Coverage not checked')).toHaveLength(2);
    expect(screen.queryByText('Outside service area')).not.toBeInTheDocument();
    expect(screen.queryByText('In service area')).not.toBeInTheDocument();
  });

  it('an address with no map pin says so, rather than claiming coverage either way', async () => {
    const v = view();
    v.addresses = [{ ...v.addresses[0]!, id: SITE_NOPIN, geo: null, serviceability: null }];
    mockClient.getCustomer360.mockResolvedValue(v);

    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(within(screen.getByTestId(`address-${SITE_NOPIN}`)).getByText('No map pin')).toBeInTheDocument();
  });

  it('"Booked by": the customer, Staff, or — when `createdBy` is unknown (never a guess)', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    const rows = screen.getAllByRole('row');
    const orderRow = (id: string) => rows.find((r) => within(r).queryByRole('link', { name: new RegExp(id.slice(-4)) }))!;

    expect(within(orderRow('order-1')).getByText('Zara Rich')).toBeInTheDocument();
    expect(within(orderRow('order-2')).getByText('Staff')).toBeInTheDocument();
    // order-3 has bookedByThisCustomer: null → an em dash, NOT "Staff".
    expect(within(orderRow('order-3')).queryByText('Staff')).not.toBeInTheDocument();
  });

  it('an UNPRICED order shows an em dash, never $0.00', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getAllByText('$158.20 CAD').length).toBeGreaterThan(0);
  });

  it('order history is labelled as the ACCOUNT’s orders, not the person’s', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getByText(/Orders on this customer's account/)).toBeInTheDocument();
  });

  it('notifications: an unconfigured customer is shown as being on DEFAULTS, not as having chosen them', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getByTestId('notifications-default')).toBeInTheDocument();
    expect(screen.queryByTestId('notifications-configured')).not.toBeInTheDocument();
  });

  it('notifications: a configured customer shows their real choices', async () => {
    mockClient.getCustomer360.mockResolvedValue(
      view({ notifications: { configured: true, pushEnabled: false, smsEnabled: true, emailEnabled: false, quietHoursStart: 1320, quietHoursEnd: 420, timezone: 'America/Toronto' } }),
    );
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('notifications-configured');
    expect(screen.getByText('22:00 – 07:00')).toBeInTheDocument();
  });

  it('never renders chat, and says so', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getByText(/messages between the customer and their driver are not shown/i)).toBeInTheDocument();
  });

  // ── the rest ──

  it('shows the masked push token and never a full one', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(within(screen.getByTestId('devices')).getByText('…9876')).toBeInTheDocument();
  });

  it('links each order to the order detail page', async () => {
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/orders/'));
    expect(links).toHaveLength(3);
  });

  it('a customer with nothing renders empty states, not blank sections', async () => {
    mockClient.getCustomer360.mockResolvedValue(
      view({ addresses: [], orders: [], accountOrderCount: 0, invoices: [], payments: [], devices: [], memberships: [] }),
    );
    render(<CustomerDetail userId={USER_ID} />);
    await screen.findByTestId('customer-360');
    expect(screen.getByText('No saved addresses')).toBeInTheDocument();
    expect(screen.getByText('No orders')).toBeInTheDocument();
    expect(screen.getByText('No invoices')).toBeInTheDocument();
    expect(screen.getByText('No payments')).toBeInTheDocument();
    expect(screen.getByText('No devices')).toBeInTheDocument();
  });

  it("surfaces the SERVER's problem+json message (e.g. a 404 for a non-customer) with a retry", async () => {
    // `useAsync` shows an ApiError's message verbatim; a non-ApiError degrades to a generic line.
    mockClient.getCustomer360.mockRejectedValue(
      new ApiError(404, { error: 'admin.customer_not_found', status: 404 }, 'customer not found'),
    );
    render(<CustomerDetail userId={USER_ID} />);
    expect(await screen.findByText('customer not found')).toBeInTheDocument();
  });

  it('RBAC: CSR may view; DISPATCHER may not, and the PII request is never made', async () => {
    mockMe = me(RoleType.CSR);
    const { unmount } = render(<CustomerDetail userId={USER_ID} />);
    await waitFor(() => expect(mockClient.getCustomer360).toHaveBeenCalled());
    unmount();

    jest.clearAllMocks();
    mockMe = me(RoleType.DISPATCHER);
    render(<CustomerDetail userId={USER_ID} />);
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
    // Critically: no request ⇒ no server-side CUSTOMER_360_VIEWED audit row for a user who may not look.
    expect(mockClient.getCustomer360).not.toHaveBeenCalled();
  });
});
