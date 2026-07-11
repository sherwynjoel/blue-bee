import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  RoleType,
  type AccountDetailView,
  type AccountScorecard,
  type BillingTermsView,
  type GeneratedForAccountView,
  type InvoiceView,
  type Metric,
  type MeResponse,
  type StandingOrderView,
} from '@blue-bee/shared';

const mockClient = {
  getAccount: jest.fn(),
  accountScorecard: jest.fn(),
  listStandingOrders: jest.fn(),
  getServices: jest.fn(),
  getGeneratedForAccount: jest.fn(),
  getBillingTerms: jest.fn(),
  setBillingTerms: jest.fn(),
  batchInvoice: jest.fn(),
  createStandingOrder: jest.fn(),
  updateStandingOrder: jest.fn(),
  deleteStandingOrder: jest.fn(),
  runStandingOrderGeneration: jest.fn(),
  getCostCenterReport: jest.fn(),
  listCostCenters: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { AccountDetail } from './AccountDetail';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}
const ok = <T,>(value: T | null, rowCount: number | null = 1): Metric<T> => ({ value, available: true, status: 'ok', rowCount, note: 'computed' });
const deferred = <T,>(): Metric<T> => ({ value: null, available: false, status: 'unavailable_in_phase_1', rowCount: null, note: 'Phase 2' });

const ACCOUNT: AccountDetailView = {
  id: 'acct-b',
  name: 'Harbourview Condos',
  type: 'BUSINESS' as never,
  billingMode: 'BATCH_PERIODIC' as never,
  billingNetDays: 30,
  siteCount: 1,
  activeStandingOrderCount: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  sites: [{ id: 'site-1', name: 'Harbourview building' }],
};
const SCORECARD: AccountScorecard = {
  accountId: 'acct-b',
  accountName: 'Harbourview Condos',
  range: { from: '2026-05-27T00:00:00.000Z', to: '2026-06-26T00:00:00.000Z' },
  generatedAt: '2026-06-26T00:00:00.000Z',
  currency: 'CAD',
  metrics: {
    lossRatePercent: ok(0, 4),
    onTimePercent: ok(100, 4),
    monthlySpend: ok({ total: '525.45', perMonth: '525.45', months: 1 }, 4),
    avgRatingScore: ok(4.5, 4),
    costCenterSplit: deferred<Record<string, string>>(),
  },
};
const SO: StandingOrderView = {
  id: 'so-1',
  accountId: 'acct-b',
  siteId: 'site-1',
  serviceId: 'svc-1',
  vertical: 'LINEN' as never,
  cadence: 'WEEKLY' as never,
  weekday: 1,
  pickupWindow: { start: '07:00', end: '09:00' },
  concierge: true,
  // cost-centre split-billing landed on another branch (Phase-2 attribution); null here.
  costCenterId: null,
  active: true,
  startsOn: '2026-06-01',
  endsOn: null,
  nextRunAt: '2026-06-29T00:00:00.000Z',
  lastRunAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
};
const GENERATED: GeneratedForAccountView = {
  accountId: 'acct-b',
  occurrences: [{ id: 'occ-1', standingOrderId: 'so-1', periodKey: '2026-06-22', orderId: 'ord-11111111', routeId: 'rt-22222222', generatedAt: '2026-06-22T07:00:00.000Z' }],
  orderCount: 1,
  routeCount: 1,
};
const TERMS: BillingTermsView = { accountId: 'acct-b', billingMode: 'BATCH_PERIODIC' as never, billingNetDays: 30 };
const INVOICE: InvoiceView = {
  id: 'inv-1',
  orderId: null,
  number: 'INV-ABCDEF12-2026-06',
  status: 'ISSUED' as never,
  subtotal: '465.00',
  tax: '60.45',
  total: '525.45',
  currency: 'CAD',
  lines: [{ description: 'Order 11111111 — 2026-06-22', quantity: 1, unitAmount: '135.60', amount: '135.60' }],
  costCenterBreakdown: [],
  issuedAt: '2026-06-26T00:00:00.000Z',
  paidAt: null,
  dueAt: '2026-07-26T00:00:00.000Z',
  createdAt: '2026-06-26T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.getAccount.mockResolvedValue(ACCOUNT);
  mockClient.accountScorecard.mockResolvedValue(SCORECARD);
  mockClient.listStandingOrders.mockResolvedValue({ standingOrders: [SO], nextCursor: null, hasMore: false });
  mockClient.getServices.mockResolvedValue({ services: [{ id: 'svc-1', name: 'Amenity linen', vertical: 'LINEN', unit: 'PIECE', baseRate: '1.25' }] });
  mockClient.getGeneratedForAccount.mockResolvedValue(GENERATED);
  mockClient.getBillingTerms.mockResolvedValue(TERMS);
  mockClient.setBillingTerms.mockResolvedValue(TERMS);
  mockClient.batchInvoice.mockResolvedValue(INVOICE);
  mockClient.createStandingOrder.mockResolvedValue(SO);
  mockClient.updateStandingOrder.mockResolvedValue({ ...SO, active: false });
  mockClient.deleteStandingOrder.mockResolvedValue(undefined);
  mockClient.runStandingOrderGeneration.mockResolvedValue({ asOf: '2026-06-26T00:00:00.000Z', standingOrdersConsidered: 1, occurrencesCreated: 1, ordersCreated: 1, routesCreated: 1, routeFailures: 0 });
  // Harbourview has no cost centres → the scorecard split tile fetches the report and shows an honest "—".
  mockClient.getCostCenterReport.mockResolvedValue({ accountId: 'acct-b', from: SCORECARD.range.from, to: SCORECARD.range.to, currency: 'CAD', rows: [], grandTotal: { subtotal: '0.00', tax: '0.00', total: '0.00' } });
  mockClient.listCostCenters.mockResolvedValue({ costCenters: [] });
});

describe('AccountDetail (B2B account console, full management)', () => {
  it('renders the header, scorecard (honest Metric), standing orders, generated feed, and billing for an OWNER', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await waitFor(() => expect(mockClient.getAccount).toHaveBeenCalledWith('acct-b'));

    // Every section actually calls its endpoint (not just renders pre-seeded mock data).
    await waitFor(() => expect(mockClient.accountScorecard).toHaveBeenCalledWith('acct-b'));
    expect(mockClient.listStandingOrders).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct-b' }));
    expect(mockClient.getGeneratedForAccount).toHaveBeenCalledWith('acct-b');
    expect(mockClient.getBillingTerms).toHaveBeenCalledWith('acct-b');

    expect(await screen.findByText('Harbourview Condos')).toBeInTheDocument();
    // scorecard — real value + the wired cost-centre split tile (honest "No split this period" with no centres)
    expect(within(await screen.findByTestId('stat-On-time')).getByText('100%')).toBeInTheDocument();
    expect(await within(screen.getByTestId('stat-Cost-center split')).findByText('No split this period')).toBeInTheDocument();
    await waitFor(() => expect(mockClient.getCostCenterReport).toHaveBeenCalledWith('acct-b', expect.objectContaining({ from: SCORECARD.range.from, to: SCORECARD.range.to })));
    // standing order row
    const row = await screen.findByTestId('so-so-1');
    expect(within(row).getByText('Weekly')).toBeInTheDocument();
    expect(within(row).getByText('Mon')).toBeInTheDocument();
    expect(within(row).getByText('07:00–09:00')).toBeInTheDocument();
    expect(within(row).getByText('Concierge')).toBeInTheDocument();
    // generated feed
    expect(await screen.findByTestId('occ-occ-1')).toBeInTheDocument();
    // billing present for finance-capable OWNER
    expect(screen.getByText('Billing')).toBeInTheDocument();
  });

  it('creates a standing order via the existing endpoint', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByTestId('so-so-1');
    fireEvent.click(screen.getByText('New standing order'));

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'site-1' } });
    fireEvent.change(await screen.findByLabelText('Service'), { target: { value: 'svc-1' } });
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-07-06' } });
    fireEvent.click(screen.getByText('Create standing order'));

    await waitFor(() => expect(mockClient.createStandingOrder).toHaveBeenCalled());
    expect(mockClient.createStandingOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-b', siteId: 'site-1', serviceId: 'svc-1', cadence: 'WEEKLY', weekday: 1, concierge: false, pickupWindow: { start: '07:00', end: '09:00' } }),
    );
    // The list is re-fetched after the create (proves the UI reflects the new row, not stale data).
    await waitFor(() => expect(mockClient.listStandingOrders).toHaveBeenCalledTimes(2));
  });

  it('edits (pause) and deletes a standing order via the existing endpoints', async () => {
    render(<AccountDetail accountId="acct-b" />);
    const row = await screen.findByTestId('so-so-1');
    fireEvent.click(within(row).getByText('Pause'));
    await waitFor(() => expect(mockClient.updateStandingOrder).toHaveBeenCalledWith('so-1', { active: false }));

    fireEvent.click(within(screen.getByTestId('so-so-1')).getByText('Delete'));
    await waitFor(() => expect(mockClient.deleteStandingOrder).toHaveBeenCalledWith('so-1'));
  });

  it('runs the org-wide generation and reports the counts', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByTestId('so-so-1');
    fireEvent.click(screen.getByText('Run due generation (org-wide)'));
    await waitFor(() => expect(mockClient.runStandingOrderGeneration).toHaveBeenCalled());
    expect(await screen.findByText(/Org-wide run:/)).toBeInTheDocument();
  });

  it('saves billing terms and generates a batch invoice', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Billing');
    fireEvent.change(await screen.findByLabelText('Net days'), { target: { value: '15' } });
    fireEvent.click(screen.getByText('Save terms'));
    await waitFor(() => expect(mockClient.setBillingTerms).toHaveBeenCalledWith('acct-b', { billingMode: 'BATCH_PERIODIC', netDays: 15 }));

    fireEvent.click(screen.getByText('Generate periodic invoice'));
    await waitFor(() => expect(mockClient.batchInvoice).toHaveBeenCalled());
    const inv = await screen.findByTestId('batch-invoice');
    expect(within(inv).getByText('INV-ABCDEF12-2026-06')).toBeInTheDocument();
    expect(within(inv).getByText(/525\.45/)).toBeInTheDocument();
  });

  it('RBAC (UX): a DISPATCHER manages standing orders but sees NO billing or scorecard', async () => {
    mockMe = me(RoleType.DISPATCHER);
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByTestId('so-so-1');
    expect(screen.getByText('New standing order')).toBeInTheDocument(); // standing-order writes allowed
    expect(screen.queryByText('Billing')).not.toBeInTheDocument(); // finance-only → hidden
    expect(mockClient.getBillingTerms).not.toHaveBeenCalled();
    expect(mockClient.accountScorecard).not.toHaveBeenCalled(); // scorecard not a dispatcher capability
  });

  it('RBAC (UX): a CSR reads the scorecard but cannot write standing orders or see billing', async () => {
    mockMe = me(RoleType.CSR);
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByTestId('so-so-1');
    await waitFor(() => expect(mockClient.accountScorecard).toHaveBeenCalledWith('acct-b')); // CSR DID fetch the scorecard
    expect(await screen.findByTestId('stat-On-time')).toBeInTheDocument(); // scorecard visible
    expect(screen.queryByText('New standing order')).not.toBeInTheDocument(); // no write actions
    expect(screen.queryByText('Billing')).not.toBeInTheDocument();
  });
});
