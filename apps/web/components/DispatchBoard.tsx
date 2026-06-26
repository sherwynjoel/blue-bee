'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@blue-bee/api-client';
import { ArrowRight, IdCard, Plus, Route as RouteIcon, Truck, UserCog } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize } from '@/lib/format';
import type { ShiftView } from '@/lib/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
} from './ui';
import { RequireCapability } from './AppShell';

/** Dispatch hub (Increment 13) — routes list + create, plus fleet resources (vehicles/drivers/shifts). */
export function DispatchBoard(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.fleet(me)}>
      <div className="space-y-6 animate-fade-up">
        <PageHeader title="Dispatch" subtitle="Plan routes and keep the fleet moving." />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RoutesPanel canWrite={can.dispatch(me)} />
          </div>
          <FleetResources canWrite={can.dispatch(me)} />
        </div>
      </div>
    </RequireCapability>
  );
}

/** Tone for a route status pill — kept identical to the original mapping. */
function routeTone(status: string): 'green' | 'neutral' | 'blue' {
  return status === 'PUBLISHED' || status === 'IN_PROGRESS' ? 'green' : status === 'COMPLETED' ? 'neutral' : 'blue';
}

function RoutesPanel({ canWrite }: { canWrite: boolean }): React.ReactElement {
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.listRoutes({ limit: 50 }), []);
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    if (!date) return;
    setBusy(true);
    setCreateErr(null);
    try {
      await client.createRoute({ date: new Date(date) });
      setDate('');
      reload();
    } catch (e) {
      setCreateErr(e instanceof ApiError ? e.message : 'Could not create the route.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Routes"
      subtitle="Daily delivery routes across the fleet."
      actions={
        canWrite ? (
          <div className="flex items-end gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Route date" className="w-40 font-mono tabular-nums" />
            <Button onClick={() => void create()} loading={busy} disabled={!date}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New route
            </Button>
          </div>
        ) : undefined
      }
    >
      {createErr && (
        <p className="mb-3 rounded-input bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong">{createErr}</p>
      )}
      {loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || data.routes.length === 0 ? (
        <EmptyState
          icon={<RouteIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
          title="No routes yet"
          message="No routes yet. Create one to start dispatching."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th numeric>Stops</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="stagger">
            {data.routes.map((r) => (
              <tr key={r.id} className="border-b border-hairline last:border-0 transition-colors duration-fast hover:bg-subtle" data-testid={`route-row-${r.id}`}>
                <Td className="font-mono tabular-nums">{r.date?.slice(0, 10) ?? '—'}</Td>
                <Td>
                  <StatusPill tone={routeTone(r.status)}>{humanize(r.status)}</StatusPill>
                </Td>
                <Td numeric className="text-secondary">{r.stops?.length ?? 0}</Td>
                <Td className="text-right">
                  <Link
                    href={`/dispatch/${r.id}`}
                    className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
                  >
                    Open <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function FleetResources({ canWrite }: { canWrite: boolean }): React.ReactElement {
  const { client } = useSession();
  const vehicles = useAsync(() => client.listVehicles(), []);
  const drivers = useAsync(() => client.listDrivers(), []);
  const shifts = useAsync(() => client.listShifts(), []);

  const [label, setLabel] = useState('');
  const [plate, setPlate] = useState('');
  const [vErr, setVErr] = useState<string | null>(null);
  const [driverId, setDriverId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [sErr, setSErr] = useState<string | null>(null);

  const addVehicle = async (): Promise<void> => {
    if (!label.trim()) return;
    setVErr(null);
    try {
      await client.createVehicle({ label: label.trim(), plate: plate.trim() || undefined });
      setLabel('');
      setPlate('');
      vehicles.reload();
    } catch (e) {
      setVErr(e instanceof ApiError ? e.message : 'Could not add the vehicle.');
    }
  };

  const addShift = async (): Promise<void> => {
    if (!driverId || !vehicleId) return;
    setSErr(null);
    try {
      await client.createShift({ driverId, vehicleId });
      shifts.reload();
    } catch (e) {
      setSErr(e instanceof ApiError ? e.message : 'Could not create the shift.');
    }
  };

  const shiftAction = async (id: string, action: 'start' | 'end'): Promise<void> => {
    setSErr(null);
    try {
      await (action === 'start' ? client.startShift(id) : client.endShift(id));
      shifts.reload();
    } catch (e) {
      setSErr(e instanceof ApiError ? e.message : 'Action failed.');
    }
  };

  return (
    <div className="space-y-6">
      <Card title="Vehicles" subtitle="Vans and cars on the road.">
        {canWrite && (
          <div className="mb-4 space-y-2 rounded-input border border-hairline bg-subtle p-3">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Van 1)" aria-label="Vehicle label" />
            <div className="flex gap-2">
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Plate (optional)" aria-label="Plate" className="font-mono tabular-nums" />
              <Button onClick={() => void addVehicle()} disabled={!label.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </div>
            {vErr && <p className="text-footnote font-medium text-danger-strong">{vErr}</p>}
          </div>
        )}
        <ResourceList
          state={vehicles}
          icon={<Truck className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          render={(v) => `${v.label}${v.plate ? ` · ${v.plate}` : ''} · ${humanize(v.status)}`}
          empty="No vehicles."
        />
      </Card>

      <Card title="Drivers" subtitle="Licensed staff available for shifts.">
        <ResourceList
          state={drivers}
          icon={<IdCard className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />}
          render={(d) => `${d.id.slice(0, 8)} · ${d.license ?? 'no license on file'}`}
          empty="No drivers."
        />
      </Card>

      <Card title="Shifts" subtitle="Pair a driver with a vehicle for the day.">
        {canWrite && (
          <div className="mb-4 space-y-3 rounded-input border border-hairline bg-subtle p-3">
            <Field label="Driver">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Shift driver">
                <option value="">Select driver…</option>
                {(drivers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vehicle">
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Shift vehicle">
                <option value="">Select vehicle…</option>
                {(vehicles.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button onClick={() => void addShift()} disabled={!driverId || !vehicleId} className="w-full">
              <UserCog className="h-4 w-4" aria-hidden="true" />
              Create shift
            </Button>
            {sErr && <p className="text-footnote font-medium text-danger-strong">{sErr}</p>}
          </div>
        )}
        {shifts.loading ? (
          <SkeletonRows rows={3} />
        ) : shifts.error ? (
          <ErrorBox message={shifts.error} onRetry={shifts.reload} />
        ) : (shifts.data ?? []).length === 0 ? (
          <EmptyState
            icon={<UserCog className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
            message="No shifts."
          />
        ) : (
          <ul className="stagger space-y-2">
            {(shifts.data ?? []).map((s: ShiftView) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-input border border-hairline bg-subtle px-3 py-2"
              >
                <span className="flex items-center gap-2 text-subhead text-ink">
                  <span className="font-mono tabular-nums">{s.id.slice(0, 8)}</span>
                  <StatusPill tone={s.status === 'ACTIVE' ? 'green' : 'neutral'}>{humanize(s.status)}</StatusPill>
                </span>
                {canWrite && s.status === 'SCHEDULED' && (
                  <Button variant="secondary" size="sm" onClick={() => void shiftAction(s.id, 'start')}>
                    Start
                  </Button>
                )}
                {canWrite && s.status === 'ACTIVE' && (
                  <Button variant="secondary" size="sm" onClick={() => void shiftAction(s.id, 'end')}>
                    End
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Compact skeleton for the inset resource lists while data loads. */
function SkeletonRows({ rows = 3 }: { rows?: number }): React.ReactElement {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-input" />
      ))}
    </div>
  );
}

function ResourceList<T extends { id: string }>({
  state,
  render,
  empty,
  icon,
}: {
  state: { data: T[] | null; loading: boolean; error: string | null; reload: () => void };
  render: (t: T) => string;
  empty: string;
  icon?: React.ReactNode;
}): React.ReactElement {
  if (state.loading) return <SkeletonRows rows={3} />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data || state.data.length === 0) {
    return <EmptyState icon={icon} message={empty} />;
  }
  return (
    <ul className="stagger divide-y divide-hairline text-subhead text-ink">
      {state.data.map((t) => (
        <li key={t.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
          {icon && <span className="shrink-0 text-tertiary">{icon}</span>}
          <span className="min-w-0 truncate">{render(t)}</span>
        </li>
      ))}
    </ul>
  );
}
