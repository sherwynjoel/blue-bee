import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  RoleType,
  type AccountScorecard,
  type CommercialAnalytics,
  type Metric,
  type MeResponse,
  type OperationalAnalytics,
} from '@blue-bee/shared';

const mockClient = {
  analyticsOperational: jest.fn(),
  analyticsCommercial: jest.fn(),
  accountScorecard: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { AnalyticsHome } from './AnalyticsHome';

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

const ok = <T,>(value: T | null, rowCount: number | null = 0): Metric<T> => ({
  value,
  available: true,
  status: 'ok',
  rowCount,
  note: 'computed',
});
const deferred = <T,>(): Metric<T> => ({
  value: null,
  available: false,
  status: 'unavailable_in_phase_1',
  rowCount: null,
  note: 'Deferred to Phase 2.',
});

const operational: OperationalAnalytics = {
  range: { from: '2025-11-01T00:00:00.000Z', to: '2025-12-01T00:00:00.000Z' },
  generatedAt: '2025-12-01T00:00:00.000Z',
  timezone: 'America/Toronto',
  metrics: {
    onTimePickupPercent: ok(50, 2),
    onTimeDeliveryPercent: ok(50, 2),
    routeAdherencePercent: ok(80, 5),
    stopsPerHour: ok(0.69, 4),
    avgDwellMinutes: ok<number>(null, 0), // computed but no rows → honest "—"
    failedSkipRatePercent: ok(20, 5),
    itemsLostRatePercent: ok(25, 4),
    rewashRatePercent: ok(25, 4),
    plantThroughput: ok({ itemsCompleted: 3, perDay: 0.1 }, 3),
    parStockoutIncidents: deferred<number>(),
    ppoh: deferred<number>(),
  },
};

const commercial: CommercialAnalytics = {
  range: { from: '2025-11-01T00:00:00.000Z', to: '2025-12-01T00:00:00.000Z' },
  generatedAt: '2025-12-01T00:00:00.000Z',
  currency: 'CAD',
  metrics: {
    trackedGmv: ok('1000.00', 4),
    jobCount: ok(4, 4),
    jobsPerWeek: ok(0.93, 4),
    repeatRatePercent: ok(50, 2),
    revenuePerRoute: ok('700.00', 1),
    arAging: ok(
      {
        asOf: '2025-12-01T00:00:00.000Z',
        buckets: [
          { label: 'current', amount: '300.00', count: 1 },
          { label: '1-30', amount: '500.00', count: 1 },
          { label: '31-60', amount: '0.00', count: 0 },
          { label: '61-90', amount: '0.00', count: 0 },
          { label: '90+', amount: '0.00', count: 0 },
        ],
        totalOutstanding: '800.00',
      },
      2,
    ),
    quoteApprovalConversionPercent: ok(50, 4),
    medianQuoteApprovalHours: ok(4, 2),
    damageClaimRatePercent: ok(25, 4),
    medianClaimResolutionDays: ok(3, 1),
    activeContracts: deferred<number>(),
    csat: deferred<number>(),
  },
};

const scorecard: AccountScorecard = {
  accountId: 'acct-a',
  accountName: 'Analytics Fixture A',
  range: { from: '2025-11-01T00:00:00.000Z', to: '2025-12-01T00:00:00.000Z' },
  generatedAt: '2025-12-01T00:00:00.000Z',
  currency: 'CAD',
  metrics: {
    lossRatePercent: ok(33, 3),
    onTimePercent: ok(50, 4),
    monthlySpend: ok({ total: '250.00', perMonth: '250.00', months: 1 }, 2),
    costCenterSplit: deferred<Record<string, string>>(),
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.OWNER);
  mockClient.analyticsOperational.mockResolvedValue(operational);
  mockClient.analyticsCommercial.mockResolvedValue(commercial);
  mockClient.accountScorecard.mockResolvedValue(scorecard);
});

describe('AnalyticsHome (console, RBAC-gated)', () => {
  it('renders the operational + commercial dashboards with real values for an OWNER', async () => {
    render(<AnalyticsHome />);
    await waitFor(() => expect(mockClient.analyticsOperational).toHaveBeenCalled());

    // operational computed values
    expect(within(screen.getByTestId('stat-On-time pickup')).getByText('50%')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-Route adherence')).getByText('80%')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-Plant throughput')).getByText(/3 items/)).toBeInTheDocument();
    // a plausible stops/hour renders its computed value (formatted)
    expect(within(screen.getByTestId('stat-Stops / hour')).getByText('0.69')).toBeInTheDocument();

    // commercial computed values — money is grouped with thousands separators
    await waitFor(() => expect(screen.getByTestId('stat-Tracked GMV')).toBeInTheDocument());
    expect(within(screen.getByTestId('stat-Tracked GMV')).getByText(/1,000\.00/)).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-Quote→approval')).getByText('50%')).toBeInTheDocument();

    // AR aging table
    expect(within(screen.getByTestId('ar-1-30')).getByText(/500\.00/)).toBeInTheDocument();
  });

  it('HONESTY: deferred Phase-2 metrics show a "Phase 2" badge, never a fake number', async () => {
    render(<AnalyticsHome />);
    await waitFor(() => expect(screen.getByTestId('stat-Par stockouts')).toBeInTheDocument());
    expect(within(screen.getByTestId('stat-Par stockouts')).getByText('Phase 2')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('stat-Active contracts')).toBeInTheDocument());
    expect(within(screen.getByTestId('stat-Active contracts')).getByText('Phase 2')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-CSAT')).getByText('Phase 2')).toBeInTheDocument();
  });

  it('GUARD: an implausible stops/hour renders honest "insufficient data", not the absurd number', async () => {
    mockClient.analyticsOperational.mockResolvedValue({
      ...operational,
      // A collapsed on-site-time denominator makes the real, computed ratio explode (the e2e-seed artifact).
      metrics: { ...operational.metrics, stopsPerHour: ok(195652, 4) },
    });
    render(<AnalyticsHome />);
    await waitFor(() => expect(screen.getByTestId('stat-Stops / hour')).toBeInTheDocument());
    const tile = screen.getByTestId('stat-Stops / hour');
    expect(within(tile).getByText(/insufficient data/i)).toBeInTheDocument();
    // The absurd figure is NOT presented as a real value (it is disclosed only in the tooltip).
    expect(within(tile).queryByText(/195,652/)).not.toBeInTheDocument();
    expect(tile.getAttribute('title')).toMatch(/195,652/);
  });

  it('HONESTY: a computed metric with no rows shows "—", not 0', async () => {
    render(<AnalyticsHome />);
    await waitFor(() => expect(screen.getByTestId('stat-Avg dwell (min)')).toBeInTheDocument());
    expect(within(screen.getByTestId('stat-Avg dwell (min)')).getByText('—')).toBeInTheDocument();
  });

  it('loads a per-account scorecard on demand (OWNER)', async () => {
    render(<AnalyticsHome />);
    // The scorecard starts empty until an id is entered.
    expect(screen.getByText(/Enter an account id/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Account id'), { target: { value: 'acct-a' } });
    fireEvent.click(screen.getByText('Load'));

    await waitFor(() => expect(mockClient.accountScorecard).toHaveBeenCalledWith('acct-a', expect.any(Object)));
    expect(await screen.findByText('Analytics Fixture A')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-Loss rate')).getByText('33%')).toBeInTheDocument();
  });

  it('RBAC (UX): a DISPATCHER sees operational but NOT the finance-only commercial dashboard', async () => {
    mockMe = me(RoleType.DISPATCHER);
    render(<AnalyticsHome />);
    await waitFor(() => expect(mockClient.analyticsOperational).toHaveBeenCalled());
    expect(mockClient.analyticsCommercial).not.toHaveBeenCalled();
    expect(screen.queryByText('Commercial')).not.toBeInTheDocument();
  });

  it('RBAC (UX): a non-analytics role gets a no-access notice and no fetch', async () => {
    mockMe = me(RoleType.RESIDENTIAL_CUSTOMER);
    render(<AnalyticsHome />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.analyticsOperational).not.toHaveBeenCalled();
  });

  it('surfaces a load error with a retry', async () => {
    mockClient.analyticsOperational.mockRejectedValue(new Error('boom'));
    render(<AnalyticsHome />);
    await waitFor(() => expect(screen.getByText('Try again')).toBeInTheDocument());
  });
});
