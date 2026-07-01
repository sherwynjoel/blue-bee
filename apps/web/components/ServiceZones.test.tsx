import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { RoleType, type CoverageRequestsResult, type MeResponse, type ServiceZonesResult } from '@blue-bee/shared';

const mockClient = {
  listZones: jest.fn(),
  listCoverageRequests: jest.fn(),
  createZone: jest.fn(),
  updateZone: jest.fn(),
};
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { ServiceZonesHome, draftToPolygon } from './ServiceZones';

function me(...roles: RoleType[]): MeResponse {
  return {
    user: { userId: 'u', orgId: 'g', name: 'Staff', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] },
    org: { id: 'g', name: 'Org' },
  };
}

const ZONE_RING: Array<[number, number]> = [[-79.34, 43.70], [-79.32, 43.70], [-79.32, 43.72], [-79.34, 43.72], [-79.34, 43.70]];
const zones: ServiceZonesResult = {
  zones: [
    { id: 'z-1', name: 'Downtown', active: true, sortOrder: 0, polygon: { type: 'Polygon', coordinates: [ZONE_RING] }, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'z-2', name: 'East End', active: false, sortOrder: 1, polygon: { type: 'Polygon', coordinates: [ZONE_RING] }, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z' },
  ],
};
const coverage: CoverageRequestsResult = {
  coverageRequests: [
    { id: 'cr-1', userId: 'u9', address: '900 Nowhere Rd', lng: -79.1, lat: 43.55, context: null, createdAt: '2026-07-01T00:00:00.000Z' },
  ],
  nextCursor: null,
  hasMore: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.FINANCE);
  mockClient.listZones.mockResolvedValue(zones);
  mockClient.listCoverageRequests.mockResolvedValue(coverage);
  mockClient.createZone.mockResolvedValue(zones.zones[0]);
  mockClient.updateZone.mockResolvedValue(zones.zones[0]);
});

describe('draftToPolygon (GeoJSON round-trip contract)', () => {
  it('closes an open ring into a valid GeoJSON Polygon (first == last, single ring)', () => {
    const open: Array<[number, number]> = [[-79.34, 43.70], [-79.32, 43.70], [-79.32, 43.72], [-79.34, 43.72]];
    const poly = draftToPolygon(open);
    expect(poly.type).toBe('Polygon');
    expect(poly.coordinates).toHaveLength(1);
    const ring = poly.coordinates[0]!;
    expect(ring).toHaveLength(5); // 4 distinct + closing repeat
    expect(ring[0]!).toEqual(ring[ring.length - 1]!); // closed
  });

  it('leaves an already-closed ring closed (no double close)', () => {
    const poly = draftToPolygon(ZONE_RING);
    const ring = poly.coordinates[0]!;
    expect(ring).toHaveLength(5);
    expect(ring[0]!).toEqual(ring[4]!);
  });

  it('rejects a degenerate draft (< 3 points)', () => {
    expect(() => draftToPolygon([[-79.34, 43.70], [-79.32, 43.70]])).toThrow();
  });
});

describe('ServiceZonesHome (RBAC-gated zone console)', () => {
  it('renders the zones with active/off state and the coverage waitlist', async () => {
    render(<ServiceZonesHome />);
    await waitFor(() => expect(mockClient.listZones).toHaveBeenCalled());
    const row = screen.getByTestId('zone-row-z-1');
    expect(within(row).getByText('Downtown')).toBeInTheDocument();
    expect(within(row).getByText('active')).toBeInTheDocument();
    expect(within(screen.getByTestId('zone-row-z-2')).getByText('off')).toBeInTheDocument();
    // Coverage waitlist rendered from the server (out-of-area demand).
    expect(within(screen.getByTestId('coverage-row-cr-1')).getByText('900 Nowhere Rd')).toBeInTheDocument();
  });

  it('deactivating an active zone calls updateZone({active:false})', async () => {
    render(<ServiceZonesHome />);
    await waitFor(() => expect(screen.getByTestId('zone-toggle-z-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('zone-toggle-z-1'));
    await waitFor(() => expect(mockClient.updateZone).toHaveBeenCalledWith('z-1', { active: false }));
  });

  it('activating an off zone calls updateZone({active:true})', async () => {
    render(<ServiceZonesHome />);
    await waitFor(() => expect(screen.getByTestId('zone-toggle-z-2')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('zone-toggle-z-2'));
    await waitFor(() => expect(mockClient.updateZone).toHaveBeenCalledWith('z-2', { active: true }));
  });

  it('renaming a zone calls updateZone with the new name', async () => {
    render(<ServiceZonesHome />);
    await waitFor(() => expect(screen.getByTestId('zone-row-z-1')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('zone-row-z-1')).getByLabelText(/Rename Downtown/));
    const input = screen.getByTestId('zone-rename-input-z-1');
    fireEvent.change(input, { target: { value: 'Core' } });
    fireEvent.click(within(screen.getByTestId('zone-row-z-1')).getByText('Save'));
    await waitFor(() => expect(mockClient.updateZone).toHaveBeenCalledWith('z-1', { name: 'Core' }));
  });

  it('reordering swaps sort_order via two patches', async () => {
    render(<ServiceZonesHome />);
    await waitFor(() => expect(screen.getByTestId('zone-row-z-1')).toBeInTheDocument());
    fireEvent.click(within(screen.getByTestId('zone-row-z-1')).getByLabelText(/Move Downtown down/));
    await waitFor(() => expect(mockClient.updateZone).toHaveBeenCalledWith('z-1', { sortOrder: 1 }));
    expect(mockClient.updateZone).toHaveBeenCalledWith('z-2', { sortOrder: 0 });
  });

  it('a non-owner/finance operator sees the no-access gate', async () => {
    mockMe = me(RoleType.DISPATCHER);
    render(<ServiceZonesHome />);
    expect(screen.getByText(/don’t have access/)).toBeInTheDocument();
    expect(mockClient.listZones).not.toHaveBeenCalled();
  });
});
