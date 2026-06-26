import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';

const mockClient = { fleetLive: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

let socketState = { status: 'degraded' as 'connecting' | 'live' | 'degraded', positions: {} as Record<string, unknown> };
jest.mock('@/lib/useFleetSocket', () => ({ useFleetSocket: () => socketState }));
// next/dynamic → a synchronous stub map (avoids loading Leaflet in jsdom).
jest.mock('next/dynamic', () => () => {
  const Map = (): React.ReactElement => React.createElement('div', { 'data-testid': 'fleet-map' });
  return Map;
});

import { FleetBoard } from './FleetBoard';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Sam', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}

beforeEach(() => {
  jest.clearAllMocks();
  socketState = { status: 'degraded', positions: {} };
});

describe('FleetBoard', () => {
  it('renders the REST snapshot and shows the degraded (polling) badge when the WS is down', async () => {
    mockMe = me(RoleType.DISPATCHER);
    mockClient.fleetLive.mockResolvedValue({ vehicles: [{ vehicleId: 'v1', label: 'Van 1', lat: 43.6, lng: -79.4, recordedAt: new Date().toISOString(), ageSeconds: 5, source: 'redis', nextStopEta: null }], withoutPosition: [] });
    render(<FleetBoard />);
    await waitFor(() => expect(screen.getByTestId('fleet-v1')).toBeInTheDocument());
    expect(screen.getByText('Van 1')).toBeInTheDocument();
    expect(screen.getByText(/Snapshot \(polling\)/i)).toBeInTheDocument(); // REST-degrade, never blank
  });

  it('shows the live badge when the WS is connected', async () => {
    mockMe = me(RoleType.OWNER);
    socketState = { status: 'live', positions: {} };
    mockClient.fleetLive.mockResolvedValue({ vehicles: [], withoutPosition: [{ vehicleId: 'v2', label: 'Van 2' }] });
    render(<FleetBoard />);
    await waitFor(() => expect(screen.getByText(/● Live/)).toBeInTheDocument());
  });

  it('blocks a non-fleet role', async () => {
    mockMe = me(RoleType.PLANT_OP);
    render(<FleetBoard />);
    await waitFor(() => expect(screen.getByText(/don’t have access/i)).toBeInTheDocument());
    expect(mockClient.fleetLive).not.toHaveBeenCalled();
  });
});
