import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RoleType, type MeResponse } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';

const mockClient = { getPayment: jest.fn(), getInvoice: jest.fn(), refundPayment: jest.fn(), generateInvoice: jest.fn() };
let mockMe: MeResponse;
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient, me: mockMe }) }));

import { OrderBilling } from './OrderBilling';

function me(...roles: RoleType[]): MeResponse {
  return { user: { userId: 'u', orgId: 'g', name: 'Fin', phone: null, email: null, roles: roles.map((role) => ({ role, scope: 'ORG' as never, scopeId: null })), accountIds: [], siteIds: [] }, org: { id: 'g', name: 'Org' } };
}
const succeeded = { id: 'pay-1', orderId: 'o1', invoiceId: 'i1', method: 'CARD', amount: '293.80', currency: 'CAD', status: 'SUCCEEDED', capturedAmount: '293.80', refundedAmount: '0.00', attempts: 1, createdAt: 'c', capturedAt: 't' };
const invoice = { id: 'i1', orderId: 'o1', number: 'INV-X', status: 'PAID', subtotal: '260.00', tax: '33.80', total: '293.80', currency: 'CAD', lines: [{ description: 'Rug cleaning', quantity: 1, unitAmount: '260.00', amount: '260.00' }, { description: 'HST (13%)', quantity: 1, unitAmount: '33.80', amount: '33.80' }], issuedAt: 't', paidAt: 't', dueAt: null, createdAt: 'c' };

beforeEach(() => {
  jest.clearAllMocks();
  mockMe = me(RoleType.FINANCE);
});

describe('OrderBilling (finance, OWNER/FINANCE-gated)', () => {
  it('shows the payment + the refundable balance + a PAID invoice', async () => {
    mockClient.getPayment.mockResolvedValue(succeeded);
    mockClient.getInvoice.mockResolvedValue(invoice);
    render(<OrderBilling orderId="o1" />);
    await waitFor(() => expect(screen.getByText('SUCCEEDED')).toBeInTheDocument());
    expect(screen.getByText(/Refundable/)).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
    expect(screen.getByText(/HST/)).toBeInTheDocument();
  });

  it('renders the cost-centre split breakdown reconciling to the invoice total (real condo seed → 615.85)', async () => {
    mockClient.getPayment.mockResolvedValue(succeeded);
    mockClient.getInvoice.mockResolvedValue({
      ...invoice,
      number: 'DEMO-CONDO-2026-06',
      status: 'ISSUED',
      subtotal: '545.00',
      tax: '70.85',
      total: '615.85',
      costCenterBreakdown: [
        { costCenterId: 'm', code: 'AMEN', name: 'Amenity (gym/pool)', subtotal: '209.00', tax: '27.17', total: '236.17' },
        { costCenterId: 'a', code: 'TWR-A', name: 'Tower A', subtotal: '184.00', tax: '23.92', total: '207.92' },
        { costCenterId: 'b', code: 'TWR-B', name: 'Tower B', subtotal: '152.00', tax: '19.76', total: '171.76' },
      ],
    });
    render(<OrderBilling orderId="o1" />);
    await screen.findByTestId('cost-center-breakdown');
    expect(within(screen.getByTestId('ccb-a')).getByText(/207\.92/)).toBeInTheDocument();
    expect(within(screen.getByTestId('ccb-total')).getByText(/615\.85/)).toBeInTheDocument();
    expect(screen.getByTestId('ccb-reconciles')).toHaveTextContent(/Reconciles to the invoice total/);
  });

  it('refuses a refund larger than the refundable balance (client guard, server also enforces)', async () => {
    mockClient.getPayment.mockResolvedValue(succeeded);
    mockClient.getInvoice.mockResolvedValue(invoice);
    render(<OrderBilling orderId="o1" />);
    await waitFor(() => expect(screen.getByLabelText('Refund amount')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '999' } });
    fireEvent.click(screen.getByText('Issue refund'));
    await waitFor(() => expect(screen.getByText(/exceeds the refundable balance/i)).toBeInTheDocument());
    expect(mockClient.refundPayment).not.toHaveBeenCalled();
  });

  it('issues a valid partial refund', async () => {
    mockClient.getPayment.mockResolvedValue(succeeded);
    mockClient.getInvoice.mockResolvedValue(invoice);
    mockClient.refundPayment.mockResolvedValue({ id: 'r1', paymentId: 'pay-1', amount: '100.00', currency: 'CAD', status: 'SUCCEEDED', reason: null, createdAt: 'c' });
    render(<OrderBilling orderId="o1" />);
    await waitFor(() => expect(screen.getByLabelText('Refund amount')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Refund amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByText('Issue refund'));
    await waitFor(() => expect(mockClient.refundPayment).toHaveBeenCalledWith('pay-1', { amount: 100 }));
  });

  it('generates an invoice when none exists', async () => {
    mockClient.getPayment.mockResolvedValue(succeeded);
    mockClient.getInvoice.mockResolvedValue(null);
    mockClient.generateInvoice.mockResolvedValue(invoice);
    render(<OrderBilling orderId="o1" />);
    await waitFor(() => expect(screen.getByText('Generate')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(mockClient.generateInvoice).toHaveBeenCalledWith('o1'));
  });

  it('blocks a non-finance role', async () => {
    mockMe = me(RoleType.CSR);
    render(<OrderBilling orderId="o1" />);
    await waitFor(() => expect(screen.getByText(/don’t have access/i)).toBeInTheDocument());
    expect(mockClient.getPayment).not.toHaveBeenCalled();
  });
});
