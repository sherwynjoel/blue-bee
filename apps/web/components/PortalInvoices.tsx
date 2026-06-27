'use client';

import React from 'react';
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { money, shortDate } from '@/lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, StatusPill, Table, TableSkeleton, Td, Th, type Tone } from './ui';

/** Map an invoice status to a Daylight pill tone. */
export function invoiceTone(status: string): Tone {
  switch (status) {
    case 'PAID':
      return 'green';
    case 'OVERDUE':
      return 'red';
    case 'VOID':
      return 'neutral';
    default:
      return 'amber'; // DRAFT / ISSUED — awaiting payment
  }
}

/** The account customer's invoice list — number · status · issued · due · total (tabular money). */
export function PortalInvoices(): React.ReactElement {
  const { client } = useSession();
  const invoices = useAsync(() => client.listInvoices({ limit: 100 }), []);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Invoices" subtitle="View, download, and pay your building account’s invoices." />
      <Card padded={false}>
        <div className="p-5">
          {invoices.loading ? (
            <TableSkeleton rows={6} cols={5} />
          ) : invoices.error ? (
            <ErrorBox message={invoices.error} onRetry={invoices.reload} />
          ) : !invoices.data || invoices.data.invoices.length === 0 ? (
            <EmptyState title="No invoices yet" message="Invoices issued to your account will appear here." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Status</Th>
                  <Th>Issued</Th>
                  <Th>Due</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody className="stagger divide-y divide-hairline">
                {invoices.data.invoices.map((inv) => (
                  <tr key={inv.id} className="transition-colors duration-fast hover:bg-subtle" data-testid={`invoice-${inv.id}`}>
                    <Td>
                      <Link
                        href={`/portal/${inv.id}`}
                        className="rounded font-mono text-subhead font-semibold tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {inv.number ?? `#${inv.id.slice(0, 8)}`}
                      </Link>
                    </Td>
                    <Td>
                      <StatusPill tone={invoiceTone(inv.status)}>{inv.status}</StatusPill>
                    </Td>
                    <Td className="text-secondary">{shortDate(inv.issuedAt)}</Td>
                    <Td className="text-secondary">{shortDate(inv.dueAt)}</Td>
                    <Td numeric>{money(inv.total, inv.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
