'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ItemStatus } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { statusLabel } from '@/lib/order-status';
import { humanize, money, orderRef, shortDate } from '@/lib/format';
import type { ItemView, OrderDetail as Order } from '@/lib/types';
import { Badge, Card, ErrorBox, Loading } from './ui';
import { StatusTimeline } from './StatusTimeline';
import { OrderActions } from './order/OrderActions';
import { QuotePanel } from './order/QuotePanel';
import { InspectionForm } from './order/InspectionForm';

export function OrderDetailView({ orderId }: { orderId: string }): React.ReactElement {
  const { client, me } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.getOrder(orderId), [orderId]);
  const [order, setOrder] = useState<Order | null>(null);
  const [inspecting, setInspecting] = useState<ItemView | null>(null);

  useEffect(() => {
    if (data) setOrder(data);
  }, [data]);

  if (loading) return <Loading />;
  if (error || !order) return <ErrorBox message={error ?? 'Order not found.'} onRetry={reload} />;

  const payStatus = order.totals?.paymentStatus;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/orders" className="text-sm text-bb-sub hover:underline">
            ← Orders
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-bb-ink">
            {orderRef(order.id)}
            <Badge tone="blue">{statusLabel(order.status)}</Badge>
            {payStatus && <Badge tone={payStatus === 'PAID' ? 'green' : payStatus === 'FAILED' ? 'red' : 'amber'}>{humanize(payStatus)}</Badge>}
          </h1>
          <p className="text-sm text-bb-sub">Booked {shortDate(order.createdAt)}</p>
        </div>
        <OrderActions order={order} onChanged={setOrder} />
      </div>

      <Card title="Progress">
        <StatusTimeline status={order.status} heldFrom={order.heldFrom} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Items (${order.items.length})`}>
          <div className="space-y-4">
            {order.items.map((item) => (
              <ItemBlock key={item.id} item={item} canInspect={can.intake(me) && item.status !== ItemStatus.DELIVERED} onInspect={() => setInspecting(item)} />
            ))}
            {order.items.length === 0 && <p className="text-sm text-bb-sub">No items on this order.</p>}
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Quote">
            <QuotePanel order={order} onChanged={setOrder} />
          </Card>
          {can.finance(me) && (
            <Card title="Billing">
              <p className="text-sm text-bb-sub">
                Payment: <span className="font-medium text-bb-ink">{payStatus ? humanize(payStatus) : 'Not yet charged'}</span>
              </p>
              {order.totals?.total && <p className="text-sm text-bb-sub">Total: {money(order.totals.total, order.totals.currency)}</p>}
              <Link href={`/finance/${order.id}`} className="mt-2 inline-block text-sm font-semibold text-bb-blue hover:underline">
                Open billing →
              </Link>
            </Card>
          )}
        </div>
      </div>

      {inspecting && <InspectionForm orderId={order.id} item={inspecting} onClose={() => setInspecting(null)} onDone={(o) => { setOrder(o); setInspecting(null); }} />}
    </div>
  );
}

function ItemBlock({ item, canInspect, onInspect }: { item: ItemView; canInspect: boolean; onInspect: () => void }): React.ReactElement {
  const damage = item.inspections.find((i) => i.preexistingDamage);
  const measures = item.measurements && typeof item.measurements === 'object' ? Object.entries(item.measurements as Record<string, unknown>) : [];
  const photos = item.photos.filter((p) => p.downloadUrl);
  return (
    <div className="rounded-lg border border-bb-line p-3" data-testid={`item-${item.id}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium text-bb-ink">
          {item.kind} · <span className="text-bb-sub">{humanize(item.status)}</span>
        </span>
        {canInspect && (
          <button className="text-sm font-semibold text-bb-blue hover:underline" onClick={onInspect} data-testid={`inspect-${item.id}`}>
            Inspect
          </button>
        )}
      </div>
      {measures.length > 0 && <p className="mt-1 text-xs text-bb-sub">{measures.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
      {damage && (
        <p className="mt-1 text-xs text-amber-700">
          ⚠ Pre-existing damage flagged{damage.ackAt ? ` — acknowledged ${shortDate(damage.ackAt)}` : ' — awaiting ack'}
        </p>
      )}
      {photos.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={p.downloadUrl!} alt={p.kind} className="h-16 w-16 rounded object-cover" data-testid={`photo-${p.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
