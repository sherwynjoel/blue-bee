'use client';

import React, { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Radio, Truck, MapPinOff, Navigation } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { useFleetSocket } from '@/lib/useFleetSocket';
import { can } from '@/lib/rbac';
import { timeAgo } from '@/lib/format';
import type { MapVehicle } from './FleetMap';
import { Card, EmptyState, ErrorBox, PageHeader, Skeleton, StatusPill, cn } from './ui';
import { RequireCapability } from './AppShell';

// The map is a browser-only seam (Leaflet touches window) → dynamic import, no SSR.
const FleetMap = dynamic(() => import('./FleetMap'), {
  ssr: false,
  loading: () => (
    <Skeleton className="h-[560px] w-full rounded-card border border-hairline" />
  ),
});

export function FleetBoard(): React.ReactElement {
  const { me } = useSession();
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

  // The connection pill — tone + label preserved verbatim (tests assert "● Live" and "Snapshot (polling)").
  // Rendered exactly once (in the PageHeader) so getByText matches a single node.
  const statusTone = status === 'live' ? 'green' : 'amber';
  const statusLabel = status === 'live' ? '● Live' : status === 'connecting' ? 'Connecting…' : 'Snapshot (polling)';
  const statusPill = <StatusPill tone={statusTone}>{statusLabel}</StatusPill>;
  // A short, non-asserted glass-panel caption (kept distinct from the pill's exact label text).
  const statusCaption = status === 'live' ? 'Streaming' : status === 'connecting' ? 'Connecting' : 'Snapshot';

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Live fleet" subtitle="Real-time positions across your fleet" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-[560px] w-full rounded-card border border-hairline lg:col-span-2" />
          <Card title="Vehicles">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !data) return <ErrorBox message={error ?? 'Could not load the fleet.'} onRetry={reload} />;

  // Merge: REST snapshot, overlaid with any live WS position (which marks the marker green/live).
  const vehicles: MapVehicle[] = data.vehicles.map((v) => {
    const live = positions[v.vehicleId];
    return { vehicleId: v.vehicleId, label: v.label, lat: live?.lat ?? v.lat, lng: live?.lng ?? v.lng, live: !!live };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live fleet"
        subtitle="Real-time positions across your fleet"
        actions={statusPill}
      />

      {/* Map dominates (2/3 on desktop); the vehicle list sits beside it and scrolls so it never dwarfs the map. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative lg:col-span-2">
          {vehicles.length === 0 ? (
            <EmptyState
              icon={<MapPinOff className="h-5 w-5" strokeWidth={1.75} />}
              title="No vehicles on the map yet"
              message="No vehicles are reporting a position yet."
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-card border border-hairline shadow-e1 animate-fade-in">
                <FleetMap vehicles={vehicles} height={560} />
              </div>
              {/* Floating frosted "live" panel — a calm status read over the map. Distinct caption,
                  not the exact pill label, so the asserted connection text stays single-source. */}
              <div className="pointer-events-none absolute left-4 top-4 z-[400] flex items-center gap-2 rounded-full border border-hairline px-3.5 py-1.5 shadow-e2 glass animate-fade-up">
                <Radio
                  className={cn('h-4 w-4', status === 'live' ? 'text-success' : 'text-warning')}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="text-footnote font-semibold text-ink">{statusCaption}</span>
              </div>
            </>
          )}
        </div>

        <Card
          title="Vehicles"
          subtitle={`${data.vehicles.length} live · ${data.withoutPosition.length} idle`}
        >
          <ul className="stagger -mx-1 max-h-[500px] divide-y divide-hairline overflow-y-auto px-1">
            {data.vehicles.map((v) => {
              const live = positions[v.vehicleId];
              return (
                <li
                  key={v.vehicleId}
                  className="flex items-center justify-between gap-3 py-2.5"
                  data-testid={`fleet-${v.vehicleId}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Navigation className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} aria-hidden="true" />
                    <span className="truncate text-subhead font-medium text-ink">{v.label}</span>
                  </span>
                  {live ? (
                    <StatusPill tone="green">live</StatusPill>
                  ) : (
                    <span className="shrink-0 font-mono text-footnote tabular-nums text-tertiary">
                      updated {timeAgo(v.recordedAt)}
                    </span>
                  )}
                </li>
              );
            })}
            {data.withoutPosition.map((v) => (
              <li key={v.vehicleId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <Truck className="h-4 w-4 shrink-0 text-tertiary" strokeWidth={2} aria-hidden="true" />
                  <span className="truncate text-subhead text-secondary">{v.label}</span>
                </span>
                <span className="shrink-0 text-footnote text-tertiary">no position</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
