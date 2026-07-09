import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RoleType, WeighPoint, type MeResponse, type OrderWeightView } from '@blue-bee/shared';

const mockClient = { weighOrder: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

// Mock the live hook so the panel test never opens a socket — the socket is proven by the live curl proof.
let mockWeight: { weight: OrderWeightView | null; loading: boolean; error: string | null; live: boolean; lastEvent: null; refresh: jest.Mock };
jest.mock('@/lib/useOrderWeightLive', () => ({ useOrderWeightLive: () => mockWeight }));

import { WeightPanel } from './WeightPanel';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Sam', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}
const weightView = (over: Partial<OrderWeightView> = {}): OrderWeightView => ({
  orderId: 'o1',
  authoritativeWeightKg: '6.00',
  authoritativeWeighPoint: WeighPoint.PLANT,
  captures: [{ id: 'c1', orderId: 'o1', itemId: null, weightKg: '6.00', weighPoint: WeighPoint.PLANT, capturedByUserId: 'u', capturedAt: '2026-07-10T00:00:00.000Z', source: 'driver', note: null }],
  customerEstimate: 5,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWeight = { weight: weightView(), loading: false, error: null, live: true, lastEvent: null, refresh: jest.fn() };
});

describe('WeightPanel (Inc-23 P3)', () => {
  it('renders the authoritative weight + capture history', () => {
    mockMe = me(RoleType.OWNER);
    render(<WeightPanel orderId="o1" />);
    expect(screen.getByTestId('weight-authoritative').textContent).toContain('6.00');
    expect(screen.getByTestId('weight-history')).toBeInTheDocument();
  });

  it('an OWNER can post an audited correction → weighOrder writes a NEW capture (source owner_adjustment)', async () => {
    mockMe = me(RoleType.OWNER);
    mockClient.weighOrder.mockResolvedValue({});
    render(<WeightPanel orderId="o1" />);
    fireEvent.change(screen.getByTestId('weight-override-input'), { target: { value: '7.2' } });
    fireEvent.click(screen.getByTestId('weight-override-save'));
    await waitFor(() => expect(mockClient.weighOrder).toHaveBeenCalledWith('o1', expect.objectContaining({ weightKg: 7.2, weighPoint: WeighPoint.PLANT, source: 'owner_adjustment' })));
    expect(mockWeight.refresh).toHaveBeenCalled();
  });

  it('hides the override form for a non-intake role (FINANCE)', () => {
    mockMe = me(RoleType.FINANCE);
    render(<WeightPanel orderId="o1" />);
    expect(screen.queryByTestId('weight-override')).toBeNull();
  });

  it('shows the pending state (+ customer estimate) when not yet weighed', () => {
    mockMe = me(RoleType.OWNER);
    mockWeight.weight = weightView({ authoritativeWeightKg: null, authoritativeWeighPoint: null, captures: [] });
    render(<WeightPanel orderId="o1" />);
    expect(screen.getByTestId('weight-pending').textContent).toContain('~5 kg');
  });
});
