'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, PackageSearch } from 'lucide-react';
import { OrderStatus } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { statusLabel } from '@/lib/order-status';
import { money, orderRef, shortDate } from '@/lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, Select, StatusPill, Table, TableSkeleton, Td, Th } from './ui';

/** The orders queue — `GET /v1/orders` (row-scoped), filterable by §5.1 status. The console hub. */
export function OrdersQueue(): React.ReactElement {
  const { client } = useSession();
  const [status, setStatus] = useState<string>('');

  const { data, loading, error, reload } = useAsync(() => client.listOrders({ limit: 50, status: status ? (status as OrderStatus) : undefined }), [status]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        subtitle="Live operator queue across the §5.1 lifecycle."
        actions={
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
        }
      />

      <Card padded={false}>
        {loading ? (
          <div className="p-5">
            <TableSkeleton rows={6} cols={5} />
          </div>
        ) : error ? (
          <div className="p-5">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        ) : !data || data.orders.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={<PackageSearch className="h-5 w-5" strokeWidth={1.75} />}
              title="No orders here"
              message="No orders match this filter. Clear the filter to see the full queue."
            />
          </div>
        ) : (
          <div className="px-1.5 pb-1.5">
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Status</Th>
                  <Th numeric>Total / estimate</Th>
                  <Th>Booked</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="stagger">
                {data.orders.map((o) => {
                  const est = o.totals?.estimateRange;
                  const total = o.totals?.total;
                  return (
                    <tr key={o.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`order-row-${o.id}`}>
                      <Td className="font-mono font-medium tabular-nums">{orderRef(o.id)}</Td>
                      <Td>
                        <StatusPill tone={statusTone(o.status)}>{statusLabel(o.status)}</StatusPill>
                      </Td>
                      <Td numeric>
                        {total ? money(total, o.totals?.currency) : est ? `${money(est.low, est.currency)}–${money(est.high, est.currency)}` : '—'}
                      </Td>
                      <Td className="text-secondary">{shortDate(o.createdAt)}</Td>
                      <Td className="text-right">
                        <Link
                          href={`/orders/${o.id}`}
                          className="inline-flex items-center gap-1 font-semibold text-primary transition-colors duration-fast hover:text-primary-hover focus-visible:outline-none focus-visible:shadow-focus rounded"
                        >
                          Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            {data.hasMore && (
              <p className="px-3 py-3 text-caption text-tertiary">Showing the latest {data.orders.length}. Refine with the status filter to see more.</p>
            )}
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
