'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { OrderStatus, RouteStopKind } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, orderRef, shortDate } from '@/lib/format';
import type { ManifestView, RouteView } from '@/lib/types';
import type { StopAction } from '@/lib/api-client';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading } from './ui';

/** Legal §5.4 stop transitions per current status (mirrors the server graph; illegal → server 409). */
const STOP_ACTIONS: Record<string, StopAction[]> = {
  PENDING: ['depart', 'skip'],
  EN_ROUTE: ['arrive', 'fail', 'skip'],
  ARRIVED: ['start', 'fail'],
  IN_PROGRESS: ['complete', 'fail'],
};

export function RouteDetailView({ routeId }: { routeId: string }): React.ReactElement {
  const { client, me } = useSession();
  const canWrite = can.dispatch(me);
  const { data, loading, error, reload } = useAsync(() => client.getRoute(routeId), [routeId]);
  const [route, setRoute] = useState<RouteView | null>(null);
  const [manifest, setManifest] = useState<ManifestView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Pickers for assign + add-stop.
  const drivers = useAsync(() => client.listDrivers(), []);
  const vehicles = useAsync(() => client.listVehicles(), []);
  const orders = useAsync(() => client.listOrders({ limit: 50, status: OrderStatus.REQUESTED }), []);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [stopOrderId, setStopOrderId] = useState('');

  useEffect(() => {
    if (data) setRoute(data);
  }, [data]);

  if (loading) return <Loading />;
  if (error || !route) return <ErrorBox message={error ?? 'Route not found.'} onRetry={reload} />;

  const run = async (fn: () => Promise<RouteView>, key: string): Promise<void> => {
    setBusy(key);
    setActionErr(null);
    try {
      setRoute(await fn());
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const genManifest = async (): Promise<void> => {
    setBusy('manifest');
    setActionErr(null);
    try {
      setManifest(await client.routeManifest(route.id));
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : 'Could not generate the manifest.');
    } finally {
      setBusy(null);
    }
  };

  const stopAction = async (stopId: string, action: StopAction): Promise<void> => {
    let dto = {};
    if (action === 'fail' || action === 'skip') {
      const reason = window.prompt(`Reason to ${action} this stop?`)?.trim();
      if (!reason || reason.length < 2) return;
      dto = { reason };
    }
    setBusy(`${stopId}:${action}`);
    setActionErr(null);
    try {
      await client.stopAction(stopId, action, dto);
      setRoute(await client.getRoute(route.id)); // re-sync to server truth
    } catch (e) {
      setActionErr(e instanceof ApiError ? e.message : 'Transition rejected.');
    } finally {
      setBusy(null);
    }
  };

  const isDraft = route.status === 'PLANNED';

  return (
    <div className="space-y-4">
      <div>
        <Link href="/dispatch" className="text-sm text-bb-sub hover:underline">
          ← Dispatch
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-bb-ink">
          Route {route.date?.slice(0, 10)}
          <Badge tone={route.status === 'PUBLISHED' || route.status === 'IN_PROGRESS' ? 'green' : route.status === 'COMPLETED' ? 'neutral' : 'blue'}>{humanize(route.status)}</Badge>
          {route.optimized && <Badge tone="blue">Optimized</Badge>}
        </h1>
        <p className="text-sm text-bb-sub">
          Driver: {route.driver?.user?.name ?? route.driverId?.slice(0, 8) ?? '—'} · Vehicle: {route.vehicle?.label ?? route.vehicleId?.slice(0, 8) ?? '—'}
        </p>
      </div>

      {actionErr && <ErrorBox message={actionErr} />}

      {canWrite && isDraft && (
        <Card title="Plan">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Field label="Assign driver">
                <select className="w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Assign driver">
                  <option value="">{drivers.loading ? 'Loading drivers…' : drivers.error ? 'Failed to load drivers' : 'Select…'}</option>
                  {(drivers.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Assign vehicle">
                <select className="w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Assign vehicle">
                  <option value="">{vehicles.loading ? 'Loading vehicles…' : vehicles.error ? 'Failed to load vehicles' : 'Select…'}</option>
                  {(vehicles.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="secondary" loading={busy === 'assign'} disabled={!driverId && !vehicleId} onClick={() => void run(() => client.assignRoute(route.id, { driverId: driverId || undefined, vehicleId: vehicleId || undefined }), 'assign')}>
                Assign
              </Button>
            </div>
            <div className="space-y-2">
              <Field label="Add a pickup stop (REQUESTED order)">
                <select className="w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm" value={stopOrderId} onChange={(e) => setStopOrderId(e.target.value)} aria-label="Add stop order">
                  <option value="">{orders.loading ? 'Loading orders…' : orders.error ? 'Failed to load orders' : 'Select an order…'}</option>
                  {(orders.data?.orders ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {orderRef(o.id)}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="secondary" loading={busy === 'addstop'} disabled={!stopOrderId} onClick={() => void run(async () => { await client.addStop(route.id, { orderId: stopOrderId, kind: RouteStopKind.PICKUP }); setStopOrderId(''); return client.getRoute(route.id); }, 'addstop')}>
                Add stop
              </Button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-bb-line pt-4">
            <Button variant="secondary" loading={busy === 'optimize'} onClick={() => void run(() => client.optimizeRoute(route.id), 'optimize')}>
              Optimize (PostGIS)
            </Button>
            <Button loading={busy === 'publish'} onClick={() => void run(() => client.publishRoute(route.id), 'publish')}>
              Publish
            </Button>
          </div>
        </Card>
      )}

      <Card title={`Stops (${route.stops?.length ?? 0})`} actions={<Button variant="secondary" loading={busy === 'manifest'} onClick={() => void genManifest()}>Manifest</Button>}>
        {!route.stops || route.stops.length === 0 ? (
          <EmptyState message="No stops yet. Add a pickup stop above." />
        ) : (
          <ol className="space-y-2">
            {route.stops.map((s) => {
              const actions = canWrite ? STOP_ACTIONS[s.status] ?? [] : [];
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bb-line p-3" data-testid={`stop-${s.id}`}>
                  <div className="text-sm">
                    <span className="font-medium text-bb-ink">#{s.seq} · {humanize(s.kind)}</span>{' '}
                    <Badge tone={s.status === 'COMPLETED' ? 'green' : s.status === 'FAILED' || s.status === 'SKIPPED' ? 'red' : 'blue'}>{humanize(s.status)}</Badge>{' '}
                    {s.orderId && <Link href={`/orders/${s.orderId}`} className="font-mono text-bb-blue hover:underline">{orderRef(s.orderId)}</Link>}
                    {s.exceptionReason && <span className="ml-2 text-xs text-red-700">({s.exceptionReason})</span>}
                  </div>
                  <div className="flex gap-1">
                    {actions.map((a) => (
                      <Button key={a} variant="secondary" loading={busy === `${s.id}:${a}`} onClick={() => void stopAction(s.id, a)} className="!px-2 !py-1 text-xs">
                        {a}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {manifest && (
        <Card title="Manifest">
          {manifest.lines.length === 0 ? (
            <EmptyState message="No expected items on this route." />
          ) : (
            <ul className="space-y-2 text-sm">
              {manifest.lines.map((l) => (
                <li key={l.stopId} className="rounded-lg border border-bb-line p-2">
                  <span className="font-medium text-bb-ink">#{l.seq} · {humanize(l.kind)}</span> · {l.expectedItemCount} item(s)
                  {l.site?.name && <span className="text-bb-sub"> · {l.site.name}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-bb-sub">Generated {shortDate(manifest.generatedAt)}</p>
        </Card>
      )}
    </div>
  );
}
