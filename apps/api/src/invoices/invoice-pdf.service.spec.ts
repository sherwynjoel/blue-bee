import { InvoicePdfService } from './invoice-pdf.service';
import type { InvoiceForStatement } from './invoices.service';

/** A minimal invoice entity shaped like InvoicesService.getEntity()'s return (no DB needed). */
function fixture(overrides: Partial<Record<string, unknown>> = {}): InvoiceForStatement {
  const base = {
    id: 'b1b00000-0000-4000-8000-0000000000f1',
    orgId: '11111111-1111-4111-8111-111111111111',
    accountId: 'b1b00000-0000-4000-8000-0000000000a0',
    orderId: null,
    period: '2026-06',
    number: 'B2B-PDF-2026-06',
    lines: [],
    subtotal: '300.00',
    tax: '39.00',
    total: '339.00',
    currency: 'CAD',
    status: 'ISSUED',
    stripeInvoiceId: null,
    issuedAt: new Date('2026-06-01T00:00:00.000Z'),
    paidAt: null,
    dueAt: new Date('2026-07-01T00:00:00.000Z'),
    costCenterBreakdown: [],
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdBy: null,
    account: { name: 'Lakeshore Residences Property Mgmt', billingMode: 'BATCH_PERIODIC', billingNetDays: 30 },
    invoiceLines: [
      { description: 'Amenity linen — Tower A', quantity: 1, unitAmount: '100.00', amount: '100.00' },
      { description: 'Amenity linen — Tower B', quantity: 1, unitAmount: '200.00', amount: '200.00' },
    ],
    ...overrides,
  };
  return base as unknown as InvoiceForStatement;
}

describe('InvoicePdfService.buildStatement', () => {
  const svc = new InvoicePdfService();

  it('renders real PDF bytes (%PDF magic + non-trivial size) for a plain invoice', async () => {
    const pdf = await svc.buildStatement(fixture());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders the cost-centre split section when the invoice carries a breakdown', async () => {
    const withSplit = fixture({
      costCenterBreakdown: [
        { costCenterId: 'cc1', code: 'TWR-A', name: 'Tower A', subtotal: '100.00', tax: '13.00', total: '113.00' },
        { costCenterId: 'cc2', code: 'TWR-B', name: 'Tower B', subtotal: '200.00', tax: '26.00', total: '226.00' },
      ],
    });
    const plain = await svc.buildStatement(fixture());
    const split = await svc.buildStatement(withSplit);
    expect(split.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // the split adds a whole section → materially more bytes than the plain statement
    expect(split.length).toBeGreaterThan(plain.length);
  });

  it('renders a PAID statement (receipt) without throwing', async () => {
    const paid = fixture({ status: 'PAID', paidAt: new Date('2026-06-15T18:30:00.000Z') });
    const pdf = await svc.buildStatement(paid);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
