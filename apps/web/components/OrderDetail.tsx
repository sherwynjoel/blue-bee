'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ImageOff, TriangleAlert } from 'lucide-react';
import { ItemStatus } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { statusLabel } from '@/lib/order-status';
import { humanize, money, orderRef, shortDate } from '@/lib/format';
import type { ItemView, OrderDetail as Order } from '@/lib/types';
import { Badge, Card, ErrorBox, KV, Skeleton, SkeletonText, StatusPill } from './ui';
import { CostCenterPicker } from './CostCenters';
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

  if (loading) return <OrderDetailSkeleton />;
  if (error || !order) return <ErrorBox message={error ?? 'Order not found.'} onRetry={reload} />;

  const payStatus = order.totals?.paymentStatus;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/orders"
            className="inline-flex items-center gap-1 text-footnote font-medium text-secondary transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:shadow-focus rounded"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Orders
          </Link>
          <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-title1 text-ink">
            <span className="font-mono tabular-nums">{orderRef(order.id)}</span>
            <StatusPill tone="blue">{statusLabel(order.status)}</StatusPill>
            {payStatus && <StatusPill tone={payStatus === 'PAID' ? 'green' : payStatus === 'FAILED' ? 'red' : 'amber'}>{humanize(payStatus)}</StatusPill>}
          </h1>
          <p className="mt-1 text-subhead text-secondary">Booked {shortDate(order.createdAt)}</p>
        </div>
        <OrderActions order={order} onChanged={setOrder} />
      </div>

      <Card title="Progress">
        <StatusTimeline status={order.status} heldFrom={order.heldFrom} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={`Items (${order.items.length})`}>
          <div className="space-y-3 stagger">
            {order.items.map((item) => (
              <ItemBlock key={item.id} item={item} canInspect={can.intake(me) && item.status !== ItemStatus.DELIVERED} onInspect={() => setInspecting(item)} />
            ))}
            {order.items.length === 0 && <p className="text-subhead text-secondary">No items on this order.</p>}
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Quote">
            <QuotePanel order={order} onChanged={setOrder} />
          </Card>
          {can.finance(me) && (
            <Card title="Billing">
              <div className="space-y-0.5">
                <KV label="Payment" value={payStatus ? humanize(payStatus) : 'Not yet charged'} />
                {order.totals?.total && <KV label="Total" value={money(order.totals.total, order.totals.currency)} mono />}
              </div>
              <Link
                href={`/finance/${order.id}`}
                className="mt-3 inline-flex items-center gap-1 text-subhead font-semibold text-primary transition-colors duration-fast hover:text-primary-hover focus-visible:outline-none focus-visible:shadow-focus rounded"
              >
                Open billing <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </Card>
          )}
          {can.accounts(me) && (
            <Card title="Cost centre">
              <CostCenterPicker
                orderId={order.id}
                accountId={order.accountId}
                value={order.costCenterId}
                canWrite={can.accounts(me)}
                onChanged={(costCenterId) => setOrder({ ...order, costCenterId })}
              />
            </Card>
          )}
        </div>
      </div>

      {inspecting && <InspectionForm orderId={order.id} item={inspecting} onClose={() => setInspecting(null)} onDone={(o) => { setOrder(o); setInspecting(null); }} />}
    </div>
  );
}

function OrderDetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-3.5 w-40" />
      </div>
      <Card title="Progress">
        <Skeleton className="h-12 w-full" />
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Items">
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-card" />
            <Skeleton className="h-20 w-full rounded-card" />
          </div>
        </Card>
        <Card title="Quote">
          <SkeletonText lines={4} />
        </Card>
      </div>
    </div>
  );
}

function ItemBlock({ item, canInspect, onInspect }: { item: ItemView; canInspect: boolean; onInspect: () => void }): React.ReactElement {
  const damage = item.inspections.find((i) => i.preexistingDamage);
  const measures = item.measurements && typeof item.measurements === 'object' ? Object.entries(item.measurements as Record<string, unknown>) : [];
  const photos = item.photos.filter((p) => p.downloadUrl);
  return (
    <div className="rounded-card border border-hairline bg-surface p-4 transition-shadow duration-fast hover:shadow-e1" data-testid={`item-${item.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-subhead font-semibold text-ink">
          {item.kind} · <Badge tone="neutral">{humanize(item.status)}</Badge>
        </span>
        {canInspect && (
          <button
            className="text-footnote font-semibold text-primary transition-colors duration-fast hover:text-primary-hover focus-visible:outline-none focus-visible:shadow-focus rounded"
            onClick={onInspect}
            data-testid={`inspect-${item.id}`}
          >
            Inspect
          </button>
        )}
      </div>
      {measures.length > 0 && <p className="mt-1.5 text-caption text-tertiary">{measures.map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</p>}
      {damage && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-btn bg-warning-tint px-2 py-1 text-caption font-medium text-warning-strong">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          Pre-existing damage flagged{damage.ackAt ? ` — acknowledged ${shortDate(damage.ackAt)}` : ' — awaiting ack'}
        </p>
      )}
      {photos.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={p.downloadUrl!} alt={p.kind} className="h-16 w-16 rounded-btn border border-hairline object-cover" data-testid={`photo-${p.id}`} />
          ))}
        </div>
      ) : (
        item.photos.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-caption text-tertiary">
            <ImageOff className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" /> Photos still processing
          </p>
        )
      )}
    </div>
  );
}
