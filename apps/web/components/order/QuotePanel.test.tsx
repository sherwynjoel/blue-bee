import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OrderStatus, QuoteStatus, RoleType, type MeResponse } from '@blue-bee/shared';
import type { OrderDetail } from '@/lib/types';

const mockClient = { buildQuote: jest.fn(), approveQuote: jest.fn(), declineQuote: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { QuotePanel } from './QuotePanel';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Sam', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}
function order(over: Partial<OrderDetail>): OrderDetail {
  return { id: 'o1', orgId: 'g', accountId: 'a', siteId: null, costCenterId: null, vertical: 'SPECIALTY', type: 'JOB', status: OrderStatus.INTAKE_INSPECTED, heldFrom: null, scheduledPickupWindow: null, scheduledDeliveryWindow: null, totals: { currency: 'CAD' }, createdAt: 'c', updatedAt: 'u', items: [], quotes: [], routeStops: [], ...over };
}

beforeEach(() => jest.clearAllMocks());

describe('QuotePanel', () => {
  it('an intake role generates a quote (server-priced)', async () => {
    mockMe = me(RoleType.PLANT_OP);
    mockClient.buildQuote.mockResolvedValue({ order: order({ status: OrderStatus.QUOTED }), quoteId: 'q1' });
    render(<QuotePanel order={order({})} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByText(/Generate & send quote/i));
    await waitFor(() => expect(mockClient.buildQuote).toHaveBeenCalledWith('o1', expect.objectContaining({ upcharges: [], expiresInDays: 14 })));
  });

  it('shows the quote totals + lets an OWNER approve a SENT quote', async () => {
    mockMe = me(RoleType.OWNER);
    const o = order({
      status: OrderStatus.QUOTED,
      quotes: [{ id: 'q1', status: QuoteStatus.SENT, subtotal: '260.00', tax: '33.80', total: '293.80', lines: [], adjustments: null, expiresAt: null, approvedBy: null, approvedAt: null, createdAt: 'c' }],
    });
    mockClient.approveQuote.mockResolvedValue(order({ status: OrderStatus.QUOTE_APPROVED }));
    render(<QuotePanel order={o} onChanged={jest.fn()} />);
    expect(screen.getByText(/293\.80/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve (on behalf)'));
    await waitFor(() => expect(mockClient.approveQuote).toHaveBeenCalledWith('o1'));
  });

  it('hides the generate form from a non-intake role', () => {
    mockMe = me(RoleType.FINANCE);
    render(<QuotePanel order={order({})} onChanged={jest.fn()} />);
    expect(screen.queryByText(/Generate & send quote/i)).not.toBeInTheDocument();
  });
});
