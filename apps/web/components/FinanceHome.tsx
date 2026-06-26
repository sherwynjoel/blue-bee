'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, money, orderRef, shortDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading } from './ui';
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-bb-ink">Finance</h1>

      <Card title="Open order billing">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (orderId.trim()) router.push(`/finance/${orderId.trim()}`);
          }}
        >
          <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Order id" aria-label="Order id" />
          <Button type="submit" disabled={!orderId.trim()}>
            Open
          </Button>
        </form>
        <p className="mt-2 text-xs text-bb-sub">Tip: open an order and use its “Billing” card to jump here.</p>
      </Card>

      <Card title="Disputes">
        {disputes.loading ? (
          <Loading />
        ) : disputes.error ? (
          <ErrorBox message={disputes.error} onRetry={disputes.reload} />
        ) : !disputes.data || disputes.data.length === 0 ? (
          <EmptyState message="No disputes. 🎉" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">Order</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
                <th className="py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {disputes.data.map((d) => (
                <tr key={d.id} className="border-b border-bb-line last:border-0" data-testid={`dispute-${d.id}`}>
                  <td className="py-2 pr-4 font-mono">
                    {d.orderId ? (
                      <button className="text-bb-blue hover:underline" onClick={() => router.push(`/finance/${d.orderId}`)}>
                        {orderRef(d.orderId)}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">{money(d.amount, d.currency)}</td>
                  <td className="py-2 pr-4">
                    <Badge tone={d.status === 'WON' ? 'green' : d.status === 'LOST' ? 'red' : 'amber'}>{humanize(d.status)}</Badge>
                  </td>
                  <td className="py-2 pr-4 text-bb-sub">{d.reason ?? '—'}</td>
                  <td className="py-2 text-bb-sub">{shortDate(d.openedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
