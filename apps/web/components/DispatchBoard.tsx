'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, shortDate } from '@/lib/format';
import type { ShiftView } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading } from './ui';
import { RequireCapability } from './AppShell';

/** Dispatch hub (Increment 13) — routes list + create, plus fleet resources (vehicles/drivers/shifts). */
export function DispatchBoard(): React.ReactElement {
  const { client, me } = useSession();
  return (
    <RequireCapability allowed={can.fleet(me)}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-bb-ink">Dispatch</h1>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RoutesPanel canWrite={can.dispatch(me)} />
          </div>
          <FleetResources canWrite={can.dispatch(me)} />
        </div>
      </div>
    </RequireCapability>
  );
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
      actions={
        canWrite ? (
          <div className="flex items-end gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Route date" className="w-40" />
            <Button onClick={() => void create()} loading={busy} disabled={!date}>
              New route
            </Button>
          </div>
        ) : undefined
      }
    >
      {createErr && <p className="mb-2 text-sm text-red-700">{createErr}</p>}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data || data.routes.length === 0 ? (
        <EmptyState message="No routes yet. Create one to start dispatching." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bb-line text-left text-bb-sub">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Stops</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.routes.map((r) => (
              <tr key={r.id} className="border-b border-bb-line last:border-0" data-testid={`route-row-${r.id}`}>
                <td className="py-3 pr-4 text-bb-ink">{r.date?.slice(0, 10) ?? '—'}</td>
                <td className="py-3 pr-4">
                  <Badge tone={r.status === 'PUBLISHED' || r.status === 'IN_PROGRESS' ? 'green' : r.status === 'COMPLETED' ? 'neutral' : 'blue'}>{humanize(r.status)}</Badge>
                </td>
                <td className="py-3 pr-4 text-bb-sub">{r.stops?.length ?? 0}</td>
                <td className="py-3 text-right">
                  <Link href={`/dispatch/${r.id}`} className="font-semibold text-bb-blue hover:underline">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
    <div className="space-y-4">
      <Card title="Vehicles">
        {canWrite && (
          <div className="mb-3 space-y-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Van 1)" aria-label="Vehicle label" />
            <div className="flex gap-2">
              <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Plate (optional)" aria-label="Plate" />
              <Button onClick={() => void addVehicle()} disabled={!label.trim()}>
                Add
              </Button>
            </div>
            {vErr && <p className="text-sm text-red-700">{vErr}</p>}
          </div>
        )}
        <ResourceList state={vehicles} render={(v) => `${v.label}${v.plate ? ` · ${v.plate}` : ''} · ${humanize(v.status)}`} empty="No vehicles." />
      </Card>

      <Card title="Drivers">
        <ResourceList state={drivers} render={(d) => `${d.id.slice(0, 8)} · ${d.license ?? 'no license on file'}`} empty="No drivers." />
      </Card>

      <Card title="Shifts">
        {canWrite && (
          <div className="mb-3 space-y-2">
            <Field label="Driver">
              <select className="w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm" value={driverId} onChange={(e) => setDriverId(e.target.value)} aria-label="Shift driver">
                <option value="">Select driver…</option>
                {(drivers.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vehicle">
              <select className="w-full rounded-lg border border-bb-line bg-white px-3 py-2 text-sm" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Shift vehicle">
                <option value="">Select vehicle…</option>
                {(vehicles.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={() => void addShift()} disabled={!driverId || !vehicleId}>
              Create shift
            </Button>
            {sErr && <p className="text-sm text-red-700">{sErr}</p>}
          </div>
        )}
        {shifts.loading ? (
          <Loading />
        ) : shifts.error ? (
          <ErrorBox message={shifts.error} onRetry={shifts.reload} />
        ) : (shifts.data ?? []).length === 0 ? (
          <EmptyState message="No shifts." />
        ) : (
          <ul className="space-y-2 text-sm">
            {(shifts.data ?? []).map((s: ShiftView) => (
              <li key={s.id} className="flex items-center justify-between">
                <span>
                  {s.id.slice(0, 8)} · <Badge tone={s.status === 'ACTIVE' ? 'green' : 'neutral'}>{humanize(s.status)}</Badge>
                </span>
                {canWrite && s.status === 'SCHEDULED' && (
                  <Button variant="secondary" onClick={() => void shiftAction(s.id, 'start')}>
                    Start
                  </Button>
                )}
                {canWrite && s.status === 'ACTIVE' && (
                  <Button variant="secondary" onClick={() => void shiftAction(s.id, 'end')}>
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

function ResourceList<T extends { id: string }>({ state, render, empty }: { state: { data: T[] | null; loading: boolean; error: string | null; reload: () => void }; render: (t: T) => string; empty: string }): React.ReactElement {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data || state.data.length === 0) return <EmptyState message={empty} />;
  return (
    <ul className="space-y-1 text-sm text-bb-ink">
      {state.data.map((t) => (
        <li key={t.id} className="border-b border-bb-line py-1 last:border-0">
          {render(t)}
        </li>
      ))}
    </ul>
  );
}
