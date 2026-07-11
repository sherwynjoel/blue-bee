import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  RoleType,
  type AccountDetailView,
  type AccountManifestsResult,
  type MeResponse,
  type OwnerExceptionsResult,
} from '@blue-bee/shared';
import type { OrderListResult } from '@/lib/types';

/**
 * Account-detail portal tabs (Track-A B2B console — Orders / Manifests / Exceptions). Proves each new
 * tab lazily mounts, calls ITS account-scoped client method (not pre-seeded mock data), renders the
 * real-shaped row, and shows an honest empty/error state. The Overview tab (scorecard + standing orders
 * + generated + billing) is covered by AccountDetail.test.tsx.
 */
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
  getAccountOrders: jest.fn(),
  getAccountManifests: jest.fn(),
  getAccountExceptions: jest.fn(),
  getCostCenterReport: jest.fn(),
  listCostCenters: jest.fn(),
  attachOrderCostCenter: jest.fn(),
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

const ACCOUNT: AccountDetailView = {
  id: 'acct-b',
  name: 'Demo — Account B (business)',
  type: 'BUSINESS' as never,
  billingMode: 'BATCH_PERIODIC' as never,
  billingNetDays: 30,
  siteCount: 1,
  activeStandingOrderCount: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  sites: [{ id: 'site-1', name: 'Demo — Harbourview Condos (B2B building)' }],
};
const ORDERS: OrderListResult = {
  orders: [
    {
      id: 'a6000000-0000-4000-8000-000000000101',
      status: 'DELIVERED' as never,
      vertical: 'LINEN',
      accountId: 'acct-b',
      siteId: 'site-1',
      costCenterId: null,
      totals: { total: '135.60', currency: 'CAD' },
      createdAt: '2026-06-24T07:00:00.000Z',
      quotes: [],
    },
  ],
  nextCursor: null,
  hasMore: false,
};
const MANIFESTS: AccountManifestsResult = {
  manifests: [
    {
      id: 'man-1',
      generatedAt: '2026-06-24T07:58:00.000Z',
      routeId: 'rt-1',
      routeStopId: 'stop-1',
      stopSeq: 1,
      stopStatus: 'COMPLETED',
      stopKind: 'PICKUP',
      orderId: 'a6000000-0000-4000-8000-000000000101',
      siteName: 'Demo — Harbourview Condos (B2B building)',
      expectedItemCount: 2,
    },
  ],
};
const EXCEPTIONS: OwnerExceptionsResult = {
  exceptions: [
    {
      id: 'held-1',
      kind: 'ORDER_HELD',
      title: 'Order on hold — Demo — Account B (business)',
      detail: 'Paused from REQUESTED',
      orderId: 'held-1',
      routeId: null,
      stopId: null,
      amount: null,
      currency: null,
      occurredAt: '2026-06-25T12:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.getAccount.mockResolvedValue(ACCOUNT);
  // Overview-tab dependencies (default tab) — keep them resolving so the page renders cleanly.
  mockClient.accountScorecard.mockResolvedValue({ accountId: 'acct-b', accountName: 'B', range: { from: '', to: '' }, generatedAt: '', currency: 'CAD', metrics: { lossRatePercent: { value: 0, available: true, status: 'ok', rowCount: 1, note: '' }, onTimePercent: { value: 100, available: true, status: 'ok', rowCount: 1, note: '' }, monthlySpend: { value: { total: '0', perMonth: '0', months: 1 }, available: true, status: 'ok', rowCount: 1, note: '' }, avgRatingScore: { value: 4.5, available: true, status: 'ok', rowCount: 4, note: '' }, costCenterSplit: { value: null, available: false, status: 'unavailable_in_phase_1', rowCount: null, note: '' } } });
  mockClient.listStandingOrders.mockResolvedValue({ standingOrders: [], nextCursor: null, hasMore: false });
  mockClient.getServices.mockResolvedValue({ services: [] });
  mockClient.getGeneratedForAccount.mockResolvedValue({ accountId: 'acct-b', occurrences: [], orderCount: 0, routeCount: 0 });
  mockClient.getBillingTerms.mockResolvedValue({ accountId: 'acct-b', billingMode: 'BATCH_PERIODIC', billingNetDays: 30 });
  // Cost centres: the overview scorecard tile reads the report; the Orders tab picker reads the list.
  mockClient.getCostCenterReport.mockResolvedValue({ accountId: 'acct-b', from: '', to: '', currency: 'CAD', rows: [], grandTotal: { subtotal: '0.00', tax: '0.00', total: '0.00' } });
  mockClient.listCostCenters.mockResolvedValue({ costCenters: [] });
  // Portal tabs.
  mockClient.getAccountOrders.mockResolvedValue(ORDERS);
  mockClient.getAccountManifests.mockResolvedValue(MANIFESTS);
  mockClient.getAccountExceptions.mockResolvedValue(EXCEPTIONS);
});

describe('AccountDetail portal tabs (Orders / Manifests / Exceptions)', () => {
  it('does not fetch any tab data until its tab is opened (lazy)', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    // Overview is the default tab — the portal reads have NOT fired.
    expect(mockClient.getAccountOrders).not.toHaveBeenCalled();
    expect(mockClient.getAccountManifests).not.toHaveBeenCalled();
    expect(mockClient.getAccountExceptions).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'false');
  });

  it('Orders tab calls getAccountOrders and renders the real order row', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    fireEvent.click(screen.getByRole('tab', { name: 'Orders' }));
    await waitFor(() => expect(mockClient.getAccountOrders).toHaveBeenCalledWith('acct-b', expect.objectContaining({ limit: 50 })));
    const row = await screen.findByTestId('order-a6000000-0000-4000-8000-000000000101');
    expect(within(row).getByText('Delivered')).toBeInTheDocument();
    expect(within(row).getByText(/135\.60/)).toBeInTheDocument();
  });

  it('Manifests tab calls getAccountManifests and renders the load-sheet row (2 expected items)', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    fireEvent.click(screen.getByRole('tab', { name: 'Manifests' }));
    await waitFor(() => expect(mockClient.getAccountManifests).toHaveBeenCalledWith('acct-b'));
    const row = await screen.findByTestId('manifest-man-1');
    expect(within(row).getByText('Pickup')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('Exceptions tab calls getAccountExceptions and renders the held-order row', async () => {
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    fireEvent.click(screen.getByRole('tab', { name: 'Exceptions' }));
    await waitFor(() => expect(mockClient.getAccountExceptions).toHaveBeenCalledWith('acct-b'));
    const row = await screen.findByTestId('exception-held-1');
    expect(within(row).getByText('Order Held')).toBeInTheDocument();
  });

  it('Manifests tab shows an honest empty state when the account has none', async () => {
    mockClient.getAccountManifests.mockResolvedValue({ manifests: [] });
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    fireEvent.click(screen.getByRole('tab', { name: 'Manifests' }));
    expect(await screen.findByText('No manifests')).toBeInTheDocument();
  });

  it('Exceptions tab surfaces a load error (no fabricated rows)', async () => {
    mockClient.getAccountExceptions.mockRejectedValue(new Error('boom'));
    render(<AccountDetail accountId="acct-b" />);
    await screen.findByText('Demo — Account B (business)');
    fireEvent.click(screen.getByRole('tab', { name: 'Exceptions' }));
    // useAsync maps a non-ApiError to its honest generic message — and renders NO exception rows.
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByTestId('exception-held-1')).not.toBeInTheDocument();
  });
});
