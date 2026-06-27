import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';

/**
 * Facility-linen console (Track-B care homes, PRD §2.2/§5.2/§B3). Proves the pack-to-par gaps render with
 * the exact par − on-hand math, par CRUD calls the client, a soiled-cart pickup posts per-SKU lines, the
 * load sheet generates, on-hand adjusts, honest empty states show, and RBAC hides every write control from
 * read-only account staff (the server enforces independently). Mocks at the `@/lib/session` seam.
 */
const mockClient = {
  listAccounts: jest.fn(),
  getAccount: jest.fn(),
  listCostCenters: jest.fn(),
  getServices: jest.fn(),
  listParLevels: jest.fn(),
  setParLevel: jest.fn(),
  updateParLevel: jest.fn(),
  listLinenStock: jest.fn(),
  adjustLinenStock: jest.fn(),
  packToPar: jest.fn(),
  generatePackToPar: jest.fn(),
  listPackToParManifests: jest.fn(),
  listSoilPickups: jest.fn(),
  recordSoilPickup: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { FacilityLinen } from './FacilityLinen';

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
const CENTRES = { costCenters: [{ id: 'cc-1', accountId: 'acct-care', siteId: 'site-1', code: 'NW', name: 'North Wing', kind: 'WING', active: true, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }] };
const SERVICES = {
  services: [
    { id: 'svc-sheet', vertical: 'LINEN', name: 'Bed sheets', unit: 'PIECE', baseRate: '0.8500' },
    { id: 'svc-towel', vertical: 'LINEN', name: 'Bath towels', unit: 'PIECE', baseRate: '0.6000' },
    { id: 'svc-rug', vertical: 'SPECIALTY', name: 'Rug clean', unit: 'SQFT', baseRate: '4.0000' },
  ],
};
const PTP = {
  siteId: 'site-1',
  costCenterId: null,
  lines: [
    { serviceId: 'svc-sheet', sku: 'Bed sheets', unit: 'PIECE', costCenterId: null, par: 120, onHand: 90, gap: 30 },
    { serviceId: 'svc-sheet', sku: 'Bed sheets', unit: 'PIECE', costCenterId: 'cc-1', par: 40, onHand: 12, gap: 28 },
  ],
  totalGap: 58,
};
const PARS = { parLevels: [{ id: 'par-1', accountId: 'acct-care', siteId: 'site-1', costCenterId: null, serviceId: 'svc-sheet', sku: 'Bed sheets', unit: 'PIECE', targetQty: 120, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' }] };

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.listAccounts.mockResolvedValue({ accounts: [{ id: 'acct-care', name: 'Demo — Maple Grove Care Home' }], nextCursor: null, hasMore: false });
  mockClient.getAccount.mockResolvedValue(ACCOUNT);
  mockClient.listCostCenters.mockResolvedValue(CENTRES);
  mockClient.getServices.mockResolvedValue(SERVICES);
  mockClient.packToPar.mockResolvedValue(PTP);
  mockClient.listPackToParManifests.mockResolvedValue({ manifests: [] });
  mockClient.listParLevels.mockResolvedValue(PARS);
  mockClient.listSoilPickups.mockResolvedValue({ pickups: [] });
});

describe('FacilityLinen (pack-to-par + par + pickups)', () => {
  it('renders the pack-to-par gaps (par − on-hand) with the cost-centre split + total', async () => {
    render(<FacilityLinen />);
    await waitFor(() => expect(mockClient.packToPar).toHaveBeenCalledWith('site-1'));
    const siteRow = await screen.findByTestId('ptp-site-svc-sheet');
    expect(within(siteRow).getByText('30')).toBeInTheDocument(); // 120 − 90
    const wingRow = screen.getByTestId('ptp-cc-1-svc-sheet');
    expect(within(wingRow).getByText('28')).toBeInTheDocument(); // 40 − 12 (wing on-hand only)
    expect(within(screen.getByTestId('ptp-total')).getByText('58')).toBeInTheDocument();
  });

  it('shows an honest empty state when no par is set', async () => {
    mockClient.packToPar.mockResolvedValue({ siteId: 'site-1', costCenterId: null, lines: [], totalGap: 0 });
    mockClient.listParLevels.mockResolvedValue({ parLevels: [] });
    render(<FacilityLinen />);
    expect(await screen.findByText('Set a par level below to see the pack-to-par gap.')).toBeInTheDocument();
    expect(await screen.findByText('Set a par level to start tracking what each wing should hold.')).toBeInTheDocument();
  });

  it('OWNER sets a par level via the form (POST) and re-fetches', async () => {
    mockClient.setParLevel.mockResolvedValue({ ...PARS.parLevels[0], serviceId: 'svc-towel', sku: 'Bath towels', targetQty: 200 });
    render(<FacilityLinen />);
    await screen.findByTestId('par-par-1');
    fireEvent.click(screen.getByTestId('par-new'));
    fireEvent.change(screen.getByLabelText('Linen SKU'), { target: { value: 'svc-towel' } });
    fireEvent.change(screen.getByTestId('par-target'), { target: { value: '200' } });
    fireEvent.click(screen.getByTestId('par-submit'));
    await waitFor(() => expect(mockClient.setParLevel).toHaveBeenCalledWith('site-1', { serviceId: 'svc-towel', targetQty: 200 }));
    await waitFor(() => expect(mockClient.listParLevels).toHaveBeenCalledTimes(2));
  });

  it('only LINEN SKUs are offered (specialty services excluded)', async () => {
    render(<FacilityLinen />);
    await screen.findByTestId('par-par-1');
    fireEvent.click(screen.getByTestId('par-new'));
    const skuSelect = screen.getByLabelText('Linen SKU');
    expect(within(skuSelect).getByText('Bed sheets')).toBeInTheDocument();
    expect(within(skuSelect).getByText('Bath towels')).toBeInTheDocument();
    expect(within(skuSelect).queryByText('Rug clean')).not.toBeInTheDocument(); // SPECIALTY filtered out
  });

  it('records a soiled-cart pickup with per-SKU lines (POST)', async () => {
    mockClient.recordSoilPickup.mockResolvedValue({ id: 'sp-1', siteId: 'site-1', costCenterId: null, routeStopId: null, cartCount: 3, bagCount: null, weightKg: '42.50', soiled: true, lines: [{ serviceId: 'svc-towel', sku: 'Bath towels', unit: 'PIECE', qty: 18 }], totalPieces: 18, actorId: null, occurredAt: '2026-06-27T08:30:00.000Z' });
    render(<FacilityLinen />);
    await screen.findByTestId('ptp-total');
    fireEvent.click(screen.getByTestId('pickup-new'));
    fireEvent.change(screen.getByTestId('pickup-carts'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('pickup-weight'), { target: { value: '42.5' } });
    fireEvent.change(screen.getByLabelText('SKU 1'), { target: { value: 'svc-towel' } });
    fireEvent.change(screen.getByLabelText('Qty 1'), { target: { value: '18' } });
    fireEvent.click(screen.getByTestId('pickup-submit'));
    await waitFor(() => expect(mockClient.recordSoilPickup).toHaveBeenCalledWith('site-1', { cartCount: 3, weightKg: 42.5, lines: [{ serviceId: 'svc-towel', qty: 18 }] }));
  });

  it('generates a pack-to-par load sheet (POST) and adjusts on-hand (POST)', async () => {
    mockClient.generatePackToPar.mockResolvedValue({ id: 'm-1', siteId: 'site-1', costCenterId: null, kind: 'PACK_TO_PAR', lines: PTP.lines, totalGap: 58, generatedAt: '2026-06-27T09:00:00.000Z' });
    mockClient.adjustLinenStock.mockResolvedValue({ stock: { siteId: 'site-1', costCenterId: null, serviceId: 'svc-sheet', sku: 'Bed sheets', unit: 'PIECE', onHand: 100, updatedAt: '2026-06-27T09:00:00.000Z' }, movement: { id: 'mv-1', type: 'ADJUSTMENT', qty: 10, occurredAt: '2026-06-27T09:00:00.000Z' } });
    render(<FacilityLinen />);
    await screen.findByTestId('ptp-total');

    fireEvent.click(screen.getByTestId('ptp-generate'));
    await waitFor(() => expect(mockClient.generatePackToPar).toHaveBeenCalledWith('site-1', {}));

    fireEvent.click(screen.getByTestId('ptp-adjust-site-svc-sheet'));
    fireEvent.change(await screen.findByTestId('adjust-onhand-input'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('adjust-onhand-save'));
    await waitFor(() => expect(mockClient.adjustLinenStock).toHaveBeenCalledWith('site-1', { serviceId: 'svc-sheet', onHand: 100 }));
  });

  it('RBAC: read-only ACCOUNT_ADMIN sees the data but NO write controls', async () => {
    mockMe = me(RoleType.ACCOUNT_ADMIN);
    render(<FacilityLinen />);
    await screen.findByTestId('ptp-total'); // reads still render
    expect(screen.queryByTestId('par-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pickup-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptp-generate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ptp-adjust-site-svc-sheet')).not.toBeInTheDocument();
  });
});
