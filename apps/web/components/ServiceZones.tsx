'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ApiError } from '@blue-bee/api-client';
import type { CoverageRequestView, GeoPolygon, ServiceZoneView } from '@blue-bee/shared';
import { ChevronDown, ChevronUp, MapPin, Pencil, Pentagon, Plus, Undo2, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { timeAgo } from '@/lib/format';
import {
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Skeleton,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
} from './ui';
import { RequireCapability } from './AppShell';

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

// The drawing map is a browser-only seam (Leaflet touches window) → dynamic import, no SSR (mirrors FleetBoard).
const ZoneEditorMap = dynamic(() => import('./ZoneEditorMap'), {
  ssr: false,
  loading: () => <Skeleton className="h-[520px] w-full rounded-card border border-hairline" />,
});

/**
 * Close a drawn ring into a GeoJSON Polygon. The editor holds an OPEN ring of [lng,lat] vertices; the server
 * validates a closed ring (first == last), ≥ 4 positions, ≥ 3 distinct — so we append the first vertex to
 * close it. This is the exact payload the API stores as PostGIS geography and reads back via ST_AsGeoJSON
 * (the GeoJSON round-trip proven by the API e2e). Exported for unit testing.
 */
export function draftToPolygon(draft: Array<[number, number]>): GeoPolygon {
  const ring = draft.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || ring.length < 3) throw new Error('a zone needs at least 3 points');
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Service zones (Increment 19) — the owner/finance geo-blocking console. Draw polygon service zones on the
 * (existing Leaflet) map, name/activate/reorder/redraw them, and read the captured out-of-area demand. RBAC:
 * OWNER/FINANCE (mirrors the server @Roles on /v1/service-zones + /v1/coverage-requests). The SERVER is
 * authoritative — this only manages the zones; the block is enforced at booking.
 */
export function ServiceZonesHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.zones(me)}>
      <ServiceZonesInner />
    </RequireCapability>
  );
}

function ServiceZonesInner(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const zonesState = useAsync(() => client.listZones(), [nonce]);
  const coverageState = useAsync(() => client.listCoverageRequests({ limit: 50 }), [nonce]);

  const [draft, setDraft] = useState<Array<[number, number]>>([]);
  const [drawing, setDrawing] = useState(false);
  const [name, setName] = useState('');
  const [redrawId, setRedrawId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const zones = useMemo(() => zonesState.data?.zones ?? [], [zonesState.data]);
  const reload = (): void => setNonce((n) => n + 1);

  const startDraw = (): void => {
    setDraft([]);
    setName('');
    setRedrawId(null);
    setDrawing(true);
    setErr(null);
  };

  const startRedraw = (z: ServiceZoneView): void => {
    // Load the existing ring (drop the closing repeat so the editor holds an OPEN ring) and enter draw mode.
    const ring = (z.polygon.coordinates[0] ?? []).slice(0, -1) as Array<[number, number]>;
    setDraft(ring);
    setName(z.name);
    setRedrawId(z.id);
    setDrawing(true);
    setErr(null);
  };

  const cancelDraw = (): void => {
    setDrawing(false);
    setDraft([]);
    setRedrawId(null);
    setName('');
  };

  const addPoint = (lng: number, lat: number): void => setDraft((d) => [...d, [lng, lat]]);
  const undoPoint = (): void => setDraft((d) => d.slice(0, -1));

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      const polygon = draftToPolygon(draft);
      if (redrawId) {
        await client.updateZone(redrawId, { name: name.trim() || undefined, polygon });
      } else {
        await client.createZone({ name: name.trim(), polygon });
      }
      cancelDraw();
      reload();
    } catch (e) {
      setErr(apiErr(e, 'Could not save the zone. Check the shape and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const patchZone = async (z: ServiceZoneView, patch: { active?: boolean; name?: string; sortOrder?: number }): Promise<void> => {
    setErr(null);
    try {
      await client.updateZone(z.id, patch);
      reload();
    } catch (e) {
      setErr(apiErr(e, 'Could not update the zone.'));
    }
  };

  // Swap sort_order with the adjacent zone (a real reorder via two patches).
  const move = async (index: number, dir: -1 | 1): Promise<void> => {
    const a = zones[index];
    const b = zones[index + dir];
    if (!a || !b) return;
    await client.updateZone(a.id, { sortOrder: b.sortOrder });
    await client.updateZone(b.id, { sortOrder: a.sortOrder });
    reload();
  };

  const canSave = draft.length >= 3 && (!!redrawId || name.trim().length > 0);
  const coverage = coverageState.data?.coverageRequests ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Service zones"
        subtitle="Draw the areas you serve. A booking whose address falls outside every active zone is blocked and captured as demand. Corporate residents & members are never blocked."
        actions={
          !drawing ? (
            <Button onClick={startDraw} data-testid="zone-draw-start">
              <Pentagon className="h-4 w-4" strokeWidth={2} /> Draw a zone
            </Button>
          ) : undefined
        }
      />

      {err && <p className="text-sm text-danger" role="alert">{err}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="overflow-hidden rounded-card border border-hairline shadow-e1">
            <ZoneEditorMap zones={zones} draft={draft} drawing={drawing} onAddPoint={addPoint} />
          </div>

          {drawing && (
            <Card
              title={redrawId ? 'Redraw zone' : 'New zone'}
              subtitle="Click the map to drop each corner; add at least 3 to enclose an area."
            >
              <div className="flex flex-wrap items-end gap-3" data-testid="zone-draw-form">
                <div className="min-w-[16rem] flex-1">
                  <Field label="Zone name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Downtown core" data-testid="zone-name-input" />
                  </Field>
                </div>
                <StatusPill tone={draft.length >= 3 ? 'green' : 'neutral'}>{draft.length} point{draft.length === 1 ? '' : 's'}</StatusPill>
                <Button variant="secondary" onClick={undoPoint} disabled={draft.length === 0}>
                  <Undo2 className="h-4 w-4" strokeWidth={2} /> Undo
                </Button>
                <Button variant="secondary" onClick={() => setDraft([])} disabled={draft.length === 0}>
                  Clear
                </Button>
                <Button onClick={save} loading={busy} disabled={!canSave} data-testid="zone-save">
                  <Plus className="h-4 w-4" strokeWidth={2} /> {redrawId ? 'Save redraw' : 'Save zone'}
                </Button>
                <Button variant="ghost" onClick={cancelDraw}>
                  <X className="h-4 w-4" strokeWidth={2} /> Cancel
                </Button>
              </div>
            </Card>
          )}
        </div>

        <Card title="Zones" subtitle={`${zones.filter((z) => z.active).length} active · ${zones.length} total`}>
          {zonesState.loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : zonesState.error ? (
            <ErrorBox message={zonesState.error} onRetry={reload} />
          ) : zones.length === 0 ? (
            <EmptyState icon={<MapPin className="h-5 w-5" strokeWidth={1.75} />} title="No zones yet" message="Draw your first service zone to turn on geo-blocking." />
          ) : (
            <ul className="-mx-1 divide-y divide-hairline px-1">
              {zones.map((z, i) => (
                <ZoneRow
                  key={z.id}
                  zone={z}
                  first={i === 0}
                  last={i === zones.length - 1}
                  onToggle={() => patchZone(z, { active: !z.active })}
                  onRename={(n) => patchZone(z, { name: n })}
                  onRedraw={() => startRedraw(z)}
                  onMoveUp={() => move(i, -1)}
                  onMoveDown={() => move(i, 1)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CoverageRequests loading={coverageState.loading} error={coverageState.error} rows={coverage} onRetry={reload} />
    </div>
  );
}

function ZoneRow({
  zone,
  first,
  last,
  onToggle,
  onRename,
  onRedraw,
  onMoveUp,
  onMoveDown,
}: {
  zone: ServiceZoneView;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRedraw: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(zone.name);
  return (
    <li className="flex items-center justify-between gap-2 py-2.5" data-testid={`zone-row-${zone.id}`}>
      <span className="flex min-w-0 items-center gap-2">
        <MapPin className={zone.active ? 'h-4 w-4 shrink-0 text-primary' : 'h-4 w-4 shrink-0 text-tertiary'} strokeWidth={2} aria-hidden="true" />
        {editing ? (
          <span className="flex items-center gap-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 w-40" data-testid={`zone-rename-input-${zone.id}`} />
            <Button size="sm" onClick={() => { onRename(name.trim()); setEditing(false); }} disabled={!name.trim()}>Save</Button>
          </span>
        ) : (
          <span className="truncate text-subhead font-medium text-ink">{zone.name}</span>
        )}
        <StatusPill tone={zone.active ? 'green' : 'neutral'}>{zone.active ? 'active' : 'off'}</StatusPill>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="ghost" onClick={onMoveUp} disabled={first} aria-label={`Move ${zone.name} up`}>
          <ChevronUp className="h-4 w-4" strokeWidth={2} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onMoveDown} disabled={last} aria-label={`Move ${zone.name} down`}>
          <ChevronDown className="h-4 w-4" strokeWidth={2} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-label={`Rename ${zone.name}`}>
          <Pencil className="h-4 w-4" strokeWidth={2} />
        </Button>
        <Button size="sm" variant="secondary" onClick={onRedraw} data-testid={`zone-redraw-${zone.id}`}>Redraw</Button>
        <Button size="sm" variant={zone.active ? 'secondary' : 'primary'} onClick={onToggle} data-testid={`zone-toggle-${zone.id}`}>
          {zone.active ? 'Deactivate' : 'Activate'}
        </Button>
      </span>
    </li>
  );
}

function CoverageRequests({ loading, error, rows, onRetry }: { loading: boolean; error: string | null; rows: CoverageRequestView[]; onRetry: () => void }): React.ReactElement {
  return (
    <Card title="Coverage requests" subtitle="Addresses customers tried to book that fell outside every active zone — the demand waitlist.">
      {loading ? (
        <TableSkeleton rows={4} cols={3} />
      ) : error ? (
        <ErrorBox message={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<MapPin className="h-5 w-5" strokeWidth={1.75} />} title="No out-of-area demand yet" message="When someone books outside your zones, their address lands here." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Address</Th>
              <Th>Location</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`coverage-row-${r.id}`}>
                <Td>{r.address ?? <span className="text-tertiary">(no address)</span>}</Td>
                <Td className="font-mono text-footnote tabular-nums text-secondary">{r.lat.toFixed(4)}, {r.lng.toFixed(4)}</Td>
                <Td className="text-secondary">{timeAgo(r.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
