'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { OrderStatus, RouteStopKind } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { ArrowLeft, ClipboardList, MapPin, Send, Wand2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, orderRef, shortDate } from '@/lib/format';
import type { ManifestView, RouteView } from '@/lib/types';
import type { StopAction } from '@/lib/api-client';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
} from './ui';

/** Legal §5.4 stop transitions per current status (mirrors the server graph; illegal → server 409). */
const STOP_ACTIONS: Record<string, StopAction[]> = {
  PENDING: ['depart', 'skip'],
  EN_ROUTE: ['arrive', 'fail', 'skip'],
  ARRIVED: ['start', 'fail'],
  IN_PROGRESS: ['complete', 'fail'],
};

/** Tone for a route status pill — kept identical to the original mapping. */
function routeTone(status: string): 'green' | 'neutral' | 'blue' {
  return status === 'PUBLISHED' || status === 'IN_PROGRESS' ? 'green' : status === 'COMPLETED' ? 'neutral' : 'blue';
}

/** Tone for a stop status pill — kept identical to the original mapping. */
function stopTone(status: string): 'green' | 'red' | 'blue' {
  return status === 'COMPLETED' ? 'green' : status === 'FAILED' || status === 'SKIPPED' ? 'red' : 'blue';
}

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

  if (loading) return <RouteDetailSkeleton />;
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
    <div className="space-y-6 animate-fade-up">
      <div className="space-y-3">
        <Link
          href="/dispatch"
          className="inline-flex items-center gap-1 text-footnote font-medium text-secondary underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Dispatch
        </Link>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mono tabular-nums">Route {route.date?.slice(0, 10)}</span>
              <StatusPill tone={routeTone(route.status)}>{humanize(route.status)}</StatusPill>
              {route.optimized && <Badge tone="blue">Optimized</Badge>}
            </span>
          }
          subtitle={
            <>
              Driver: {route.driver?.user?.name ?? route.driverId?.slice(0, 8) ?? '—'} · Vehicle:{' '}
              {route.vehicle?.label ?? route.vehicleId?.slice(0, 8) ?? '—'}
            </>
          }
        />
      </div>

      {actionErr && <ErrorBox message={actionErr} />}

      {canWrite && isDraft && (
        <Card title="Plan" subtitle="Assign crew, add stops, then optimize and publish.">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Assign driver">
                <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Assign driver">
                  <option value="">{drivers.loading ? 'Loading drivers…' : drivers.error ? 'Failed to load drivers' : 'Select…'}</option>
                  {(drivers.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Assign vehicle">
                <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Assign vehicle">
                  <option value="">{vehicles.loading ? 'Loading vehicles…' : vehicles.error ? 'Failed to load vehicles' : 'Select…'}</option>
                  {(vehicles.data ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                loading={busy === 'assign'}
                disabled={!driverId && !vehicleId}
                onClick={() => void run(() => client.assignRoute(route.id, { driverId: driverId || undefined, vehicleId: vehicleId || undefined }), 'assign')}
              >
                Assign
              </Button>
            </div>
            <div className="space-y-3">
              <Field label="Add a pickup stop (REQUESTED order)">
                <Select value={stopOrderId} onChange={(e) => setStopOrderId(e.target.value)} aria-label="Add stop order">
                  <option value="">{orders.loading ? 'Loading orders…' : orders.error ? 'Failed to load orders' : 'Select an order…'}</option>
                  {(orders.data?.orders ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {orderRef(o.id)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="secondary"
                loading={busy === 'addstop'}
                disabled={!stopOrderId}
                onClick={() => void run(async () => { await client.addStop(route.id, { orderId: stopOrderId, kind: RouteStopKind.PICKUP }); setStopOrderId(''); return client.getRoute(route.id); }, 'addstop')}
              >
                Add stop
              </Button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-hairline pt-5">
            <Button variant="secondary" loading={busy === 'optimize'} onClick={() => void run(() => client.optimizeRoute(route.id), 'optimize')}>
              <Wand2 className="h-4 w-4" aria-hidden="true" />
              Optimize (PostGIS)
            </Button>
            <Button loading={busy === 'publish'} onClick={() => void run(() => client.publishRoute(route.id), 'publish')}>
              <Send className="h-4 w-4" aria-hidden="true" />
              Publish
            </Button>
          </div>
        </Card>
      )}

      <Card
        title={`Stops (${route.stops?.length ?? 0})`}
        actions={
          <Button variant="secondary" loading={busy === 'manifest'} onClick={() => void genManifest()}>
            <ClipboardList className="h-4 w-4" aria-hidden="true" />
            Manifest
          </Button>
        }
      >
        {!route.stops || route.stops.length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
            title="No stops yet"
            message="No stops yet. Add a pickup stop above."
          />
        ) : (
          <ol className="stagger space-y-2">
            {route.stops.map((s) => {
              const actions = canWrite ? STOP_ACTIONS[s.status] ?? [] : [];
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-input border border-hairline bg-subtle p-3 transition-colors duration-fast hover:bg-canvas"
                  data-testid={`stop-${s.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-subhead">
                    <span className="font-semibold text-ink">
                      #{s.seq} · {humanize(s.kind)}
                    </span>
                    <StatusPill tone={stopTone(s.status)}>{humanize(s.status)}</StatusPill>
                    {s.orderId && (
                      <Link href={`/orders/${s.orderId}`} className="font-mono tabular-nums text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded">
                        {orderRef(s.orderId)}
                      </Link>
                    )}
                    {s.exceptionReason && <span className="text-caption text-danger-strong">({s.exceptionReason})</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {actions.map((a) => (
                      <Button key={a} variant="secondary" size="sm" loading={busy === `${s.id}:${a}`} onClick={() => void stopAction(s.id, a)}>
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
        <Card title="Manifest" subtitle={`Generated ${shortDate(manifest.generatedAt)}`}>
          {manifest.lines.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
              message="No expected items on this route."
            />
          ) : (
            <ul className="stagger space-y-2">
              {manifest.lines.map((l) => (
                <li key={l.stopId} className="rounded-input border border-hairline bg-subtle p-3 text-subhead">
                  <span className="font-semibold text-ink">
                    #{l.seq} · {humanize(l.kind)}
                  </span>{' '}
                  · <span className="font-mono tabular-nums">{l.expectedItemCount}</span> item(s)
                  {l.site?.name && <span className="text-secondary"> · {l.site.name}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/** Screen-shaped skeleton for the initial route load. */
function RouteDetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Card title={<Skeleton className="h-5 w-24" />}>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-input" />
          <Skeleton className="h-16 w-full rounded-input" />
          <Skeleton className="h-16 w-full rounded-input" />
        </div>
      </Card>
    </div>
  );
}
