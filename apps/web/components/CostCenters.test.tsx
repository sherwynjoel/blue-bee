import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  CostCenterKind,
  RoleType,
  type CostCenterReportView,
  type CostCenterView,
  type InvoiceView,
  type MeResponse,
} from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

/**
 * Cost-centre web UI (Track-A Phase 2) — management CRUD, the period report + CSV export, the order
 * attribution picker, the split-invoice breakdown (reconciling to the REAL condo seed total 615.85),
 * and the wired scorecard split tile. Mocks at the `@/lib/session` seam; every state is a real client
 * call (never pre-seeded), and write controls are gated to OWNER/FINANCE (the server stays authoritative).
 */
const mockClient = {
  listCostCenters: jest.fn(),
  createCostCenter: jest.fn(),
  updateCostCenter: jest.fn(),
  getCostCenterReport: jest.fn(),
  downloadCostCenterReportCsv: jest.fn(),
  attachOrderCostCenter: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import {
  CostCenterBreakdownTable,
  CostCenterManagementCard,
  CostCenterPicker,
  CostCenterReportCard,
  CostCenterSplitStat,
} from './CostCenters';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const cc = (over: Partial<CostCenterView>): CostCenterView => ({
  id: 'a',
  accountId: 'acct-1',
  siteId: null,
  code: 'TWR-A',
  name: 'Tower A',
  kind: CostCenterKind.WING,
  active: true,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

// The real condo seed centres (Tower A/B + Amenity).
const CENTRES: CostCenterView[] = [
  cc({ id: 'a', code: 'TWR-A', name: 'Tower A', kind: CostCenterKind.WING }),
  cc({ id: 'b', code: 'TWR-B', name: 'Tower B', kind: CostCenterKind.WING }),
  cc({ id: 'm', code: 'AMEN', name: 'Amenity (gym/pool)', kind: CostCenterKind.AMENITY }),
];

// The real seed report (per-centre, sorted by code asc → AMEN, TWR-A, TWR-B; reconciles to 615.85).
const REPORT: CostCenterReportView = {
  accountId: 'acct-1',
  from: '2026-06-01T00:00:00.000Z',
  to: '2026-07-01T00:00:00.000Z',
  currency: 'CAD',
  rows: [
    { costCenterId: 'm', code: 'AMEN', name: 'Amenity (gym/pool)', kind: CostCenterKind.AMENITY, orderCount: 1, subtotal: '209.00', tax: '27.17', total: '236.17' },
    { costCenterId: 'a', code: 'TWR-A', name: 'Tower A', kind: CostCenterKind.WING, orderCount: 1, subtotal: '184.00', tax: '23.92', total: '207.92' },
    { costCenterId: 'b', code: 'TWR-B', name: 'Tower B', kind: CostCenterKind.WING, orderCount: 1, subtotal: '152.00', tax: '19.76', total: '171.76' },
  ],
  grandTotal: { subtotal: '545.00', tax: '70.85', total: '615.85' },
};

const EMPTY_REPORT: CostCenterReportView = {
  accountId: 'acct-1',
  from: '2026-06-01T00:00:00.000Z',
  to: '2026-07-01T00:00:00.000Z',
  currency: 'CAD',
  rows: [{ costCenterId: null, code: 'UNASSIGNED', name: 'Unassigned', kind: null, orderCount: 0, subtotal: '0.00', tax: '0.00', total: '0.00' }],
  grandTotal: { subtotal: '0.00', tax: '0.00', total: '0.00' },
};

// The real split batch invoice (DEMO-CONDO-2026-06) — breakdown sums EXACTLY to 615.85.
const SPLIT_INVOICE: InvoiceView = {
  id: 'inv-1',
  orderId: null,
  number: 'DEMO-CONDO-2026-06',
  status: 'ISSUED' as never,
  subtotal: '545.00',
  tax: '70.85',
  total: '615.85',
  currency: 'CAD',
  lines: [{ description: 'Amenity linen — Tower A', quantity: 1, unitAmount: '184.00', amount: '184.00' }],
  costCenterBreakdown: [
    { costCenterId: 'm', code: 'AMEN', name: 'Amenity (gym/pool)', subtotal: '209.00', tax: '27.17', total: '236.17' },
    { costCenterId: 'a', code: 'TWR-A', name: 'Tower A', subtotal: '184.00', tax: '23.92', total: '207.92' },
    { costCenterId: 'b', code: 'TWR-B', name: 'Tower B', subtotal: '152.00', tax: '19.76', total: '171.76' },
  ],
  issuedAt: '2026-06-26T00:00:00.000Z',
  paidAt: null,
  dueAt: '2026-07-26T00:00:00.000Z',
  createdAt: '2026-06-26T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
});

// ───────────────────────────── management (CRUD) ─────────────────────────────

describe('CostCenterManagementCard', () => {
  it('lists an account\'s cost centres (code · name · kind · status) for any reader', async () => {
    mockMe = me(RoleType.CSR);
    mockClient.listCostCenters.mockResolvedValue({ costCenters: CENTRES });
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    await waitFor(() => expect(mockClient.listCostCenters).toHaveBeenCalledWith('acct-1'));
    const row = await screen.findByTestId('cc-a');
    expect(within(row).getByText('TWR-A')).toBeInTheDocument();
    expect(within(row).getByText('Tower A')).toBeInTheDocument();
    expect(within(row).getByText('Wing')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    // CSR reads but gets NO write controls (server still enforces independently).
    expect(screen.queryByRole('button', { name: /new cost centre/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('cc-edit-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cc-toggle-a')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when the account has no cost centres', async () => {
    mockClient.listCostCenters.mockResolvedValue({ costCenters: [] });
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    expect(await screen.findByText("No cost centres yet — add one to split this account's billing.")).toBeInTheDocument();
  });

  it('FINANCE creates a cost centre via POST and re-fetches the list', async () => {
    mockClient.listCostCenters.mockResolvedValue({ costCenters: CENTRES });
    mockClient.createCostCenter.mockResolvedValue(cc({ id: 'c', code: 'TWR-C', name: 'Tower C' }));
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    await screen.findByTestId('cc-a');

    fireEvent.click(screen.getByRole('button', { name: /new cost centre/i }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'TWR-C' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tower C' } });
    fireEvent.click(screen.getByText('Create cost centre'));

    await waitFor(() => expect(mockClient.createCostCenter).toHaveBeenCalledWith('acct-1', expect.objectContaining({ code: 'TWR-C', name: 'Tower C', kind: 'WING' })));
    await waitFor(() => expect(mockClient.listCostCenters).toHaveBeenCalledTimes(2));
  });

  it('surfaces a duplicate-code 409 from the server (never a fake success)', async () => {
    mockClient.listCostCenters.mockResolvedValue({ costCenters: CENTRES });
    mockClient.createCostCenter.mockRejectedValue(new ApiError(409, { error: 'cost_centers.duplicate_code' }, 'A cost centre with code TWR-A already exists.'));
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    await screen.findByTestId('cc-a');
    fireEvent.click(screen.getByRole('button', { name: /new cost centre/i }));
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'TWR-A' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tower A dup' } });
    fireEvent.click(screen.getByText('Create cost centre'));
    expect(await screen.findByText('A cost centre with code TWR-A already exists.')).toBeInTheDocument();
  });

  it('deactivates a cost centre via PATCH', async () => {
    mockClient.listCostCenters.mockResolvedValue({ costCenters: CENTRES });
    mockClient.updateCostCenter.mockResolvedValue(cc({ id: 'a', active: false }));
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    await screen.findByTestId('cc-a');
    fireEvent.click(screen.getByTestId('cc-toggle-a'));
    await waitFor(() => expect(mockClient.updateCostCenter).toHaveBeenCalledWith('a', { active: false }));
  });

  it('renames a cost centre via the edit modal (PATCH name + kind; code is immutable)', async () => {
    mockClient.listCostCenters.mockResolvedValue({ costCenters: CENTRES });
    mockClient.updateCostCenter.mockResolvedValue(cc({ id: 'a', name: 'Tower A West' }));
    render(<CostCenterManagementCard accountId="acct-1" sites={[]} />);
    await screen.findByTestId('cc-a');
    fireEvent.click(screen.getByTestId('cc-edit-a'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Code')).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Tower A West' } });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(mockClient.updateCostCenter).toHaveBeenCalledWith('a', { name: 'Tower A West', kind: 'WING' }));
  });
});

// ───────────────────────────── period report + CSV ─────────────────────────────

describe('CostCenterReportCard', () => {
  it('renders the per-centre report with a grand-total row reconciling to 615.85', async () => {
    mockClient.getCostCenterReport.mockResolvedValue(REPORT);
    render(<CostCenterReportCard accountId="acct-1" />);
    await waitFor(() => expect(mockClient.getCostCenterReport).toHaveBeenCalled());
    expect(within(await screen.findByTestId('ccr-a')).getByText(/207\.92/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ccr-b')).getByText(/171\.76/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ccr-total')).getByText(/615\.85/)).toBeInTheDocument();
  });

  it('downloads the real CSV bytes via the export endpoint', async () => {
    mockClient.getCostCenterReport.mockResolvedValue(REPORT);
    mockClient.downloadCostCenterReportCsv.mockResolvedValue({ blob: new Blob(['code,total\n'], { type: 'text/csv' }), filename: 'cost-centres.csv' });
    render(<CostCenterReportCard accountId="acct-1" />);
    await screen.findByTestId('ccr-total');
    fireEvent.click(screen.getByTestId('cc-report-csv'));
    await waitFor(() => expect(mockClient.downloadCostCenterReportCsv).toHaveBeenCalledWith('acct-1', expect.objectContaining({ from: expect.any(String), to: expect.any(String) })));
  });

  it('shows an honest empty state when there is no cost-centre activity in the period', async () => {
    mockClient.getCostCenterReport.mockResolvedValue(EMPTY_REPORT);
    render(<CostCenterReportCard accountId="acct-1" />);
    expect(await screen.findByText('No cost-centre activity in this period.')).toBeInTheDocument();
  });
});

// ───────────────────────────── split-invoice breakdown ─────────────────────────────

describe('CostCenterBreakdownTable', () => {
  it('renders the per-centre split and reconciles (cents-exact) to the invoice total', () => {
    render(<CostCenterBreakdownTable invoice={SPLIT_INVOICE} />);
    expect(within(screen.getByTestId('ccb-m')).getByText(/236\.17/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ccb-a')).getByText(/207\.92/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ccb-b')).getByText(/171\.76/)).toBeInTheDocument();
    // footer sums the buckets to 545.00 / 70.85 / 615.85 …
    expect(within(screen.getByTestId('ccb-total')).getByText(/615\.85/)).toBeInTheDocument();
    // … and visibly confirms it reconciles to the invoice total.
    expect(screen.getByTestId('ccb-reconciles')).toHaveTextContent(/Reconciles to the invoice total/);
  });

  it('renders nothing for an unsplit invoice (empty breakdown)', () => {
    const { container } = render(<CostCenterBreakdownTable invoice={{ ...SPLIT_INVOICE, costCenterBreakdown: [] }} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('cost-center-breakdown')).not.toBeInTheDocument();
  });
});

// ───────────────────────────── order attribution picker ─────────────────────────────

describe('CostCenterPicker', () => {
  it('reflects the current attribution and PUTs a change', async () => {
    const onChanged = jest.fn();
    mockClient.attachOrderCostCenter.mockResolvedValue({ orderId: 'o1', accountId: 'acct-1', costCenterId: 'b' });
    render(<CostCenterPicker orderId="o1" accountId="acct-1" value="a" costCenters={CENTRES} canWrite onChanged={onChanged} />);
    const select = screen.getByLabelText('Cost centre') as HTMLSelectElement;
    expect(select.value).toBe('a');
    fireEvent.change(select, { target: { value: 'b' } });
    await waitFor(() => expect(mockClient.attachOrderCostCenter).toHaveBeenCalledWith('o1', { costCenterId: 'b' }));
    expect(onChanged).toHaveBeenCalledWith('b');
  });

  it('detaches with an explicit null when "Unassigned" is chosen', async () => {
    mockClient.attachOrderCostCenter.mockResolvedValue({ orderId: 'o1', accountId: 'acct-1', costCenterId: null });
    render(<CostCenterPicker orderId="o1" accountId="acct-1" value="a" costCenters={CENTRES} canWrite />);
    fireEvent.change(screen.getByLabelText('Cost centre'), { target: { value: '' } });
    await waitFor(() => expect(mockClient.attachOrderCostCenter).toHaveBeenCalledWith('o1', { costCenterId: null }));
  });

  it('surfaces a cross-account 400 and reverts the optimistic change (server authority)', async () => {
    mockClient.attachOrderCostCenter.mockRejectedValue(new ApiError(400, { error: 'cost_centers.account_mismatch' }, 'That cost centre belongs to another account.'));
    render(<CostCenterPicker orderId="o1" accountId="acct-1" value="a" costCenters={CENTRES} canWrite />);
    const select = screen.getByLabelText('Cost centre') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'b' } });
    expect(await screen.findByText('That cost centre belongs to another account.')).toBeInTheDocument();
    await waitFor(() => expect(select.value).toBe('a')); // reverted
  });

  it('renders a read-only reflection (no control) when the viewer cannot attribute', () => {
    render(<CostCenterPicker orderId="o1" accountId="acct-1" value="a" costCenters={CENTRES} canWrite={false} />);
    expect(screen.queryByLabelText('Cost centre')).not.toBeInTheDocument();
    expect(screen.getByText('TWR-A')).toBeInTheDocument();
  });

  it('reads "Unassigned" read-only when the order has no cost centre', () => {
    render(<CostCenterPicker orderId="o1" accountId="acct-1" value={null} costCenters={CENTRES} canWrite={false} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });
});

// ───────────────────────────── scorecard split tile ─────────────────────────────

describe('CostCenterSplitStat', () => {
  it('shows the REAL split (amount + centre count) from the report', async () => {
    mockClient.getCostCenterReport.mockResolvedValue(REPORT);
    render(<CostCenterSplitStat accountId="acct-1" from="2026-06-01T00:00:00.000Z" to="2026-07-01T00:00:00.000Z" />);
    const tile = await screen.findByTestId('cc-split-real');
    expect(within(tile).getByText(/615\.85/)).toBeInTheDocument();
    expect(within(tile).getByText('3 cost centres')).toBeInTheDocument();
  });

  it('shows an honest "No split this period" when nothing is attributed (never a fabricated number)', async () => {
    mockClient.getCostCenterReport.mockResolvedValue(EMPTY_REPORT);
    render(<CostCenterSplitStat accountId="acct-1" from="2026-06-01T00:00:00.000Z" to="2026-07-01T00:00:00.000Z" />);
    expect(await screen.findByText('No split this period')).toBeInTheDocument();
  });
});
