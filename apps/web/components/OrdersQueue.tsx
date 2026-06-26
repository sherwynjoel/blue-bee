'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { OrderStatus } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { statusLabel } from '@/lib/order-status';
import { money, orderRef, shortDate } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, Select } from './ui';

/** The orders queue — `GET /v1/orders` (row-scoped), filterable by §5.1 status. The console hub. */
export function OrdersQueue(): React.ReactElement {
  const { client } = useSession();
  const [status, setStatus] = useState<string>('');

  const { data, loading, error, reload } = useAsync(() => client.listOrders({ limit: 50, status: status ? (status as OrderStatus) : undefined }), [status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bb-ink">Orders</h1>
        <div className="w-64">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.values(OrderStatus).map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data || data.orders.length === 0 ? (
          <EmptyState title="No orders here" message="No orders match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-bb-line text-left text-bb-sub">
                  <th className="py-2 pr-4 font-medium">Order</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Total / estimate</th>
                  <th className="py-2 pr-4 font-medium">Booked</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => {
                  const est = o.totals?.estimateRange;
                  const total = o.totals?.total;
                  return (
                    <tr key={o.id} className="border-b border-bb-line last:border-0" data-testid={`order-row-${o.id}`}>
                      <td className="py-3 pr-4 font-mono font-medium text-bb-ink">{orderRef(o.id)}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-bb-ink">
                        {total ? money(total, o.totals?.currency) : est ? `${money(est.low, est.currency)}–${money(est.high, est.currency)}` : '—'}
                      </td>
                      <td className="py-3 pr-4 text-bb-sub">{shortDate(o.createdAt)}</td>
                      <td className="py-3 text-right">
                        <Link href={`/orders/${o.id}`} className="font-semibold text-bb-blue hover:underline">
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.hasMore && <p className="mt-3 text-xs text-bb-sub">Showing the latest {data.orders.length}. Refine with the status filter to see more.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

function statusTone(s: OrderStatus): 'neutral' | 'green' | 'blue' | 'amber' | 'red' {
  if (s === OrderStatus.QUOTE_DECLINED || s === OrderStatus.CLOSED_NO_WORK || s === OrderStatus.DAMAGE_PREEXISTING_FLAGGED || s === OrderStatus.CLAIM_OPENED) return 'red';
  if (s === OrderStatus.QUOTED || s === OrderStatus.ON_HOLD) return 'amber';
  if (s === OrderStatus.CLOSED || s === OrderStatus.DELIVERED || s === OrderStatus.QUOTE_APPROVED) return 'green';
  return 'blue';
}
