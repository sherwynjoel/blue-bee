import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { RouteView } from '@/lib/types';

const mockClient = {
  getRoute: jest.fn(),
  listDrivers: jest.fn(async () => []),
  listVehicles: jest.fn(async () => []),
  listOrders: jest.fn(async () => ({ orders: [], nextCursor: null, hasMore: false })),
  optimizeRoute: jest.fn(),
  publishRoute: jest.fn(),
  routeManifest: jest.fn(),
  stopAction: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { RouteDetailView } from './RouteDetail';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Dis', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}
function route(over: Partial<RouteView> = {}): RouteView {
  return { id: 'r1', orgId: 'g', date: '2026-07-22', driverId: 'd1', vehicleId: 'v1', status: 'PLANNED', optimized: false, createdAt: 'c', stops: [{ id: 's1', routeId: 'r1', seq: 1, kind: 'PICKUP', status: 'PENDING', orderId: 'o1', accountId: null, siteId: null, exceptionReason: null, eta: null, arrivedAt: null, completedAt: null, timeWindow: null }], ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.DISPATCHER);
});

describe('RouteDetailView', () => {
  it('optimizes (PostGIS) and publishes a draft route', async () => {
    mockClient.getRoute.mockResolvedValue(route());
    mockClient.optimizeRoute.mockResolvedValue(route({ optimized: true }));
    mockClient.publishRoute.mockResolvedValue(route({ status: 'PUBLISHED' }));
    render(<RouteDetailView routeId="r1" />);
    await waitFor(() => expect(screen.getByText(/Optimize/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Optimize/));
    await waitFor(() => expect(mockClient.optimizeRoute).toHaveBeenCalledWith('r1'));
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(mockClient.publishRoute).toHaveBeenCalledWith('r1'));
  });

  it('drives a §5.4 stop transition (depart) and re-syncs', async () => {
    mockClient.getRoute.mockResolvedValue(route());
    mockClient.stopAction.mockResolvedValue({ id: 's1', status: 'EN_ROUTE' });
    render(<RouteDetailView routeId="r1" />);
    await waitFor(() => expect(screen.getByTestId('stop-s1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('depart'));
    await waitFor(() => expect(mockClient.stopAction).toHaveBeenCalledWith('s1', 'depart', {}));
    expect(mockClient.getRoute).toHaveBeenCalledTimes(2); // initial + re-sync
  });

  it('surfaces a 409 from an illegal transition (server authority)', async () => {
    mockClient.getRoute.mockResolvedValue(route());
    mockClient.stopAction.mockRejectedValue(new ApiError(409, { error: 'illegal_stop_transition' }, 'illegal transition'));
    render(<RouteDetailView routeId="r1" />);
    await waitFor(() => expect(screen.getByTestId('stop-s1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('depart'));
    await waitFor(() => expect(screen.getByText(/illegal transition/i)).toBeInTheDocument());
  });
});
