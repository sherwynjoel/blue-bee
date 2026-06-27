import React from 'react';
import { render, screen } from '@testing-library/react';

const mockClient = { getInvoiceById: jest.fn(), downloadInvoiceStatement: jest.fn(), payInvoice: jest.fn() };
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient }) }));

import { PortalInvoiceDetail } from './PortalInvoiceDetail';

const detail = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  orderId: null,
  number: 'INV-LAKE-2026-06',
  status: 'ISSUED',
  subtotal: '300.00',
  tax: '39.00',
  total: '339.00',
  currency: 'CAD',
  lines: [
    { description: 'Amenity linen — Tower A', quantity: 1, unitAmount: '100.00', amount: '100.00' },
    { description: 'Amenity linen — Tower B', quantity: 1, unitAmount: '200.00', amount: '200.00' },
  ],
  costCenterBreakdown: [
    { costCenterId: 'c1', code: 'TWR-A', name: 'Tower A', subtotal: '100.00', tax: '13.00', total: '113.00' },
    { costCenterId: 'c2', code: 'TWR-B', name: 'Tower B', subtotal: '200.00', tax: '26.00', total: '226.00' },
  ],
  issuedAt: '2026-06-01T00:00:00.000Z',
  paidAt: null,
  dueAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('PortalInvoiceDetail', () => {
  it('renders lines, the reconciling cost-centre split, and Pay/Download for an ISSUED invoice', async () => {
    mockClient.getInvoiceById.mockResolvedValue(detail());
    render(<PortalInvoiceDetail invoiceId="i1" />);
    expect(await screen.findByText('INV-LAKE-2026-06')).toBeInTheDocument();
    // line items + total
    expect(screen.getByText('Amenity linen — Tower A')).toBeInTheDocument();
    expect(screen.getAllByText('$339.00 CAD').length).toBeGreaterThan(0);
    // cost-centre split
    expect(screen.getByText('Cost-centre split')).toBeInTheDocument();
    expect(screen.getByTestId('cc-TWR-A')).toBeInTheDocument();
    expect(screen.getByTestId('cc-TWR-B')).toBeInTheDocument();
    // actions
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay \$339\.00 CAD/ })).toBeInTheDocument();
  });

  it('shows the receipt banner and hides Pay when PAID', async () => {
    mockClient.getInvoiceById.mockResolvedValue(detail({ status: 'PAID', paidAt: '2026-06-15T18:30:00.000Z' }));
    render(<PortalInvoiceDetail invoiceId="i1" />);
    await screen.findByText('INV-LAKE-2026-06');
    expect(screen.getByText(/Paid on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument();
    // download is still available (the paid invoice IS the receipt)
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeInTheDocument();
  });

  it('shows a not-found empty state when the invoice is out of scope', async () => {
    const { ApiError } = jest.requireActual('@blue-bee/api-client');
    mockClient.getInvoiceById.mockRejectedValue(new ApiError(404, { error: 'invoices.invoice_not_found' }, 'invoice not found'));
    render(<PortalInvoiceDetail invoiceId="i1" />);
    expect(await screen.findByText('invoice not found')).toBeInTheDocument();
  });
});
