'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Scale, Search } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, money, orderRef, shortDate } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  PageHeader,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
} from './ui';
import { RequireCapability } from './AppShell';

/** Finance home (Increment 13, OWNER/FINANCE) — open billing by order id + the org disputes list. */
export function FinanceHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.finance(me)}>
      <FinanceHomeInner />
    </RequireCapability>
  );
}

function FinanceHomeInner(): React.ReactElement {
  const { client } = useSession();
  const router = useRouter();
  const disputes = useAsync(() => client.listDisputes(), []);
  const [orderId, setOrderId] = useState('');

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Finance" subtitle="Open order billing and resolve open disputes." />

      <Card title="Open order billing">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (orderId.trim()) router.push(`/finance/${orderId.trim()}`);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" aria-hidden="true" strokeWidth={2} />
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order id" aria-label="Order id" className="pl-9" />
          </div>
          <Button type="submit" disabled={!orderId.trim()}>
            Open
          </Button>
        </form>
        <p className="mt-2 text-footnote text-tertiary">Tip: open an order and use its “Billing” card to jump here.</p>
      </Card>

      <Card title="Disputes" padded={false}>
        <div className="p-5 pt-4">
          {disputes.loading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : disputes.error ? (
            <ErrorBox message={disputes.error} onRetry={disputes.reload} />
          ) : !disputes.data || disputes.data.length === 0 ? (
            <EmptyState icon={<Scale className="h-5 w-5" strokeWidth={1.75} />} title="No open disputes" message="No disputes. 🎉" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th numeric>Amount</Th>
                  <Th>Status</Th>
                  <Th>Reason</Th>
                  <Th>Opened</Th>
                </tr>
              </thead>
              <tbody className="stagger divide-y divide-hairline">
                {disputes.data.map((d) => (
                  <tr key={d.id} className="transition-colors duration-fast hover:bg-subtle" data-testid={`dispute-${d.id}`}>
                    <Td className="font-mono tabular-nums">
                      {d.orderId ? (
                        <button
                          className="rounded text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                          onClick={() => router.push(`/finance/${d.orderId}`)}
                        >
                          {orderRef(d.orderId)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td numeric>{money(d.amount, d.currency)}</Td>
                    <Td>
                      <StatusPill tone={d.status === 'WON' ? 'green' : d.status === 'LOST' ? 'red' : 'amber'}>{humanize(d.status)}</StatusPill>
                    </Td>
                    <Td className="text-secondary">{d.reason ?? '—'}</Td>
                    <Td className="text-secondary">{shortDate(d.openedAt)}</Td>
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
