import React from 'react';
import { render, screen } from '@testing-library/react';

const mockClient = { listInvoices: jest.fn() };
jest.mock('@/lib/session', () => ({ useSession: () => ({ client: mockClient }) }));

import { PortalInvoices } from './PortalInvoices';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  accountId: 'a1',
  orderId: null,
  number: 'INV-LAKE-2026-06',
  status: 'ISSUED',
  total: '339.00',
  currency: 'CAD',
  issuedAt: '2026-06-01T00:00:00.000Z',
  dueAt: '2026-07-01T00:00:00.000Z',
  paidAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('PortalInvoices', () => {
  it('renders the caller’s invoices with status pill and tabular total', async () => {
    mockClient.listInvoices.mockResolvedValue({ invoices: [row(), row({ id: 'i2', number: 'INV-LAKE-2026-05', status: 'PAID', total: '226.00' })], nextCursor: null, hasMore: false });
    render(<PortalInvoices />);
    expect(await screen.findByText('INV-LAKE-2026-06')).toBeInTheDocument();
    expect(screen.getByText('ISSUED')).toBeInTheDocument();
    expect(screen.getByText('PAID')).toBeInTheDocument();
    expect(screen.getByText('$339.00 CAD')).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no invoices', async () => {
    mockClient.listInvoices.mockResolvedValue({ invoices: [], nextCursor: null, hasMore: false });
    render(<PortalInvoices />);
    expect(await screen.findByText('No invoices yet')).toBeInTheDocument();
  });

  it('shows an error state (server problem+json message) with retry', async () => {
    const { ApiError } = jest.requireActual('@blue-bee/api-client');
    mockClient.listInvoices.mockRejectedValue(new ApiError(500, { title: 'boom', detail: 'Server exploded' }, 'Server exploded'));
    render(<PortalInvoices />);
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
  });
});
