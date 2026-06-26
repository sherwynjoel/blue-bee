'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { useFleetSocket } from '@/lib/useFleetSocket';
import { can } from '@/lib/rbac';
import { timeAgo } from '@/lib/format';
import type { MapVehicle } from './FleetMap';
import { Badge, Card, EmptyState, ErrorBox, Loading } from './ui';
import { RequireCapability } from './AppShell';

// The map is a browser-only seam (Leaflet touches window) → dynamic import, no SSR.
const FleetMap = dynamic(() => import('./FleetMap'), {
  ssr: false,
  loading: () => <div className="flex h-[560px] items-center justify-center rounded-xl border border-bb-line bg-white"><Loading label="Loading map…" /></div>,
});

export function FleetBoard(): React.ReactElement {
  const { client, me } = useSession();
  return (
    <RequireCapability allowed={can.fleet(me)}>
      <FleetBoardInner />
    </RequireCapability>
  );
}

function FleetBoardInner(): React.ReactElement {
  const { client } = useSession();
  const { data, loading, error, reload } = useAsync(() => client.fleetLive(), []);
  const { status, positions } = useFleetSocket(client);

  // When the WS isn't live, poll the REST snapshot so the board stays fresh (REST is the source of truth).
  useEffect(() => {
    if (status === 'live') return;
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [status, reload]);

  if (loading) return <Loading label="Loading fleet…" />;
  if (error || !data) return <ErrorBox message={error ?? 'Could not load the fleet.'} onRetry={reload} />;

  // Merge: REST snapshot, overlaid with any live WS position (which marks the marker green/live).
  const vehicles: MapVehicle[] = data.vehicles.map((v) => {
    const live = positions[v.vehicleId];
    return { vehicleId: v.vehicleId, label: v.label, lat: live?.lat ?? v.lat, lng: live?.lng ?? v.lng, live: !!live };
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-bb-ink">Live fleet</h1>
        <Badge tone={status === 'live' ? 'green' : 'amber'}>{status === 'live' ? '● Live' : status === 'connecting' ? 'Connecting…' : 'Snapshot (polling)'}</Badge>
      </div>

      {/* Map dominates (2/3 on desktop); the vehicle list sits beside it and scrolls so it never dwarfs the map. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {vehicles.length === 0 ? (
            <EmptyState title="No vehicles on the map yet" message="No vehicles are reporting a position yet." />
          ) : (
            <FleetMap vehicles={vehicles} height={560} />
          )}
        </div>

        <Card title={`Vehicles (${data.vehicles.length} live · ${data.withoutPosition.length} idle)`}>
          <ul className="max-h-[500px] divide-y divide-bb-line overflow-y-auto text-sm">
            {data.vehicles.map((v) => {
              const live = positions[v.vehicleId];
              return (
                <li key={v.vehicleId} className="flex items-center justify-between py-2 pr-1" data-testid={`fleet-${v.vehicleId}`}>
                  <span className="font-medium text-bb-ink">{v.label}</span>
                  <span className="text-bb-sub">
                    {live ? <Badge tone="green">live</Badge> : <>updated {timeAgo(v.recordedAt)}</>}
                  </span>
                </li>
              );
            })}
            {data.withoutPosition.map((v) => (
              <li key={v.vehicleId} className="flex items-center justify-between py-2 pr-1 text-bb-sub">
                <span>{v.label}</span>
                <span>no position</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
