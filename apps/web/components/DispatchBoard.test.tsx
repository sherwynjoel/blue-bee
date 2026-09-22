import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';
import type { RouteView, VehicleView, DriverView, ShiftView } from '@/lib/types';

const mockClient = {
  listRoutes: jest.fn(async () => ({ routes: [] as RouteView[], nextCursor: null, hasMore: false })),
  createRoute: jest.fn(),
  listVehicles: jest.fn(async () => [] as VehicleView[]),
  createVehicle: jest.fn(),
  listDrivers: jest.fn(async () => [] as DriverView[]),
  listShifts: jest.fn(async () => [] as ShiftView[]),
  createShift: jest.fn(),
  startShift: jest.fn(),
  endShift: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { DispatchBoard } from './DispatchBoard';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Ops', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}

function route(over: Partial<RouteView> = {}): RouteView {
  return {
    id: 'r1',
    orgId: 'g',
    date: '2026-07-22',
    driverId: 'd1',
    vehicleId: 'v1',
    status: 'PLANNED',
    optimized: false,
    createdAt: 'c',
    stops: [
      { id: 's1', routeId: 'r1', seq: 1, kind: 'PICKUP', status: 'PENDING', orderId: 'o1', accountId: null, siteId: null, exceptionReason: null, eta: null, arrivedAt: null, completedAt: null, timeWindow: null },
      { id: 's2', routeId: 'r1', seq: 2, kind: 'DROPOFF', status: 'PENDING', orderId: 'o1', accountId: null, siteId: null, exceptionReason: null, eta: null, arrivedAt: null, completedAt: null, timeWindow: null },
    ],
    ...over,
  };
}

function vehicle(over: Partial<VehicleView> = {}): VehicleView {
  return { id: 'v1', label: 'Van 1', capacity: null, plate: 'ABC-123', status: 'ACTIVE', createdAt: 'c', ...over };
}

function driver(over: Partial<DriverView> = {}): DriverView {
  return { id: 'd1', userId: 'u1', name: 'Andre Cole', license: 'DL-1', defaultVehicleId: null, createdAt: 'c', ...over };
}

function shift(over: Partial<ShiftView> = {}): ShiftView {
  return { id: 'sh1', driverId: 'd1', vehicleId: 'v1', status: 'SCHEDULED', startedAt: null, endedAt: null, createdAt: 'c', ...over };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.DISPATCHER);
  mockClient.listRoutes.mockResolvedValue({ routes: [route()], nextCursor: null, hasMore: false });
  mockClient.listVehicles.mockResolvedValue([vehicle()]);
  mockClient.listDrivers.mockResolvedValue([driver()]);
  mockClient.listShifts.mockResolvedValue([shift()]);
});

describe('DispatchBoard', () => {
  it('renders the route list from the mocked client call', async () => {
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByTestId('route-row-r1')).toBeInTheDocument());
    expect(screen.getByText('2026-07-22')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // stop count
    expect(mockClient.listRoutes).toHaveBeenCalledWith({ limit: 50 });
  });

  it('labels a driver row by name, not by a UUID prefix', async () => {
    mockClient.listDrivers.mockResolvedValue([driver({ id: 'd3000000-0000-4000-8000-000000000001', name: 'Andre Cole', license: null })]);
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByText(/Andre Cole/)).toBeInTheDocument());
    // The bug: the row read "d3000000 · no license on file", so a dispatcher assigning a shift
    // could not tell three drivers apart.
    expect(screen.queryByText(/^d3000000 ·/)).not.toBeInTheDocument();
    expect(screen.getByText('Andre Cole · no license on file')).toBeInTheDocument();
  });

  it('falls back to a readable label when a driver has no linked name', async () => {
    mockClient.listDrivers.mockResolvedValue([driver({ id: 'd3000000-0000-4000-8000-000000000001', name: null, license: 'DL-9' })]);
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByText('Driver d3000000 · DL-9')).toBeInTheDocument());
  });

  it('a role WITH dispatch capability (DISPATCHER) sees the create-route/vehicle/shift controls', async () => {
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByTestId('route-row-r1')).toBeInTheDocument());
    expect(screen.getByLabelText('Route date')).toBeInTheDocument();
    expect(screen.getByText('New route')).toBeInTheDocument();
    expect(screen.getByLabelText('Vehicle label')).toBeInTheDocument();
    expect(screen.getByLabelText('Shift driver')).toBeInTheDocument();
    expect(screen.getByLabelText('Shift vehicle')).toBeInTheDocument();
    expect(screen.getByText('Create shift')).toBeInTheDocument();
  });

  it('a role WITHOUT dispatch capability (CSR — fleet-read only) sees the list but no write controls', async () => {
    mockMe = me(RoleType.CSR);
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByTestId('route-row-r1')).toBeInTheDocument());
    expect(screen.queryByLabelText('Route date')).not.toBeInTheDocument();
    expect(screen.queryByText('New route')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Vehicle label')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Shift driver')).not.toBeInTheDocument();
    expect(screen.queryByText('Create shift')).not.toBeInTheDocument();
  });

  it('a role with neither fleet nor dispatch capability (FINANCE) is blocked entirely — no request is made', async () => {
    mockMe = me(RoleType.FINANCE);
    render(<DispatchBoard />);
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument();
    expect(mockClient.listRoutes).not.toHaveBeenCalled();
    expect(mockClient.listVehicles).not.toHaveBeenCalled();
  });

  it('submits the create-route form and calls createRoute with the chosen date, then reloads the list', async () => {
    mockClient.createRoute.mockResolvedValue(route({ id: 'r2', date: '2026-08-01' }));
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByTestId('route-row-r1')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Route date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByText('New route'));

    await waitFor(() => expect(mockClient.createRoute).toHaveBeenCalledWith({ date: new Date('2026-08-01') }));
    // reload() re-fetches the list after a successful create.
    await waitFor(() => expect(mockClient.listRoutes).toHaveBeenCalledTimes(2));
  });

  it('adds a vehicle via the fleet form, trimming the label and omitting a blank plate', async () => {
    mockClient.createVehicle.mockResolvedValue(vehicle({ id: 'v2', label: 'Van 2', plate: null }));
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByLabelText('Vehicle label')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Vehicle label'), { target: { value: '  Van 2  ' } });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => expect(mockClient.createVehicle).toHaveBeenCalledWith({ label: 'Van 2', plate: undefined }));
    await waitFor(() => expect(mockClient.listVehicles).toHaveBeenCalledTimes(2));
  });

  it('creates a shift by pairing a selected driver with a selected vehicle', async () => {
    mockClient.createShift.mockResolvedValue(shift({ id: 'sh2' }));
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByLabelText('Shift driver')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Shift driver'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('Shift vehicle'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByText('Create shift'));

    await waitFor(() => expect(mockClient.createShift).toHaveBeenCalledWith({ driverId: 'd1', vehicleId: 'v1' }));
    await waitFor(() => expect(mockClient.listShifts).toHaveBeenCalledTimes(2));
  });

  it('starts a SCHEDULED shift', async () => {
    mockClient.startShift.mockResolvedValue(shift({ status: 'ACTIVE' }));
    render(<DispatchBoard />);
    await waitFor(() => expect(screen.getByText('Start')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => expect(mockClient.startShift).toHaveBeenCalledWith('sh1'));
  });
});
