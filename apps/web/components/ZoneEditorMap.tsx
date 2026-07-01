'use client';

import 'leaflet/dist/leaflet.css';
import React from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMapEvents } from 'react-leaflet';
import type { ServiceZoneView } from '@blue-bee/shared';

export interface ZoneEditorMapProps {
  /** Existing zones to render (active = solid azure, inactive = faint grey). */
  zones: ServiceZoneView[];
  /** The in-progress ring being drawn, as [lng, lat] positions (GeoJSON order). */
  draft: Array<[number, number]>;
  /** When true, a map click appends a vertex to the draft. */
  drawing: boolean;
  onAddPoint: (lng: number, lat: number) => void;
  height?: number;
}

/** [lng,lat] (GeoJSON) → [lat,lng] (Leaflet). */
const toLatLng = (ring: Array<[number, number]>): Array<[number, number]> => ring.map(([lng, lat]) => [lat, lng]);

/** Captures map clicks in draw mode and appends a vertex (Leaflet gives {lat,lng}; we store [lng,lat]). */
function ClickCapture({ enabled, onAddPoint }: { enabled: boolean; onAddPoint: (lng: number, lat: number) => void }): null {
  useMapEvents({
    click(e) {
      if (enabled) onAddPoint(e.latlng.lng, e.latlng.lat);
    },
  });
  return null;
}

/**
 * The service-zone drawing map — the SAME Leaflet + OpenStreetMap seam as FleetMap (no Google Maps / no API
 * key anywhere in the repo; this reuses the existing map, no second maps integration). Dynamically imported
 * with ssr:false by the board (Leaflet touches window). Click-to-add-vertex drawing: each click appends a
 * point; ≥3 points preview a filled polygon; the board closes the ring and POSTs the GeoJSON. Existing zones
 * render underneath so the owner can see coverage while drawing.
 */
export default function ZoneEditorMap({ zones, draft, drawing, onAddPoint, height = 520 }: ZoneEditorMapProps): React.ReactElement {
  return (
    <MapContainer center={[43.66, -79.38]} zoom={11} style={{ height, width: '100%', borderRadius: 16, overflow: 'hidden', cursor: drawing ? 'crosshair' : 'grab' }} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClickCapture enabled={drawing} onAddPoint={onAddPoint} />

      {zones.map((z) => {
        const ring = z.polygon.coordinates[0] as Array<[number, number]>;
        if (!ring || ring.length < 3) return null;
        return (
          <Polygon
            key={z.id}
            positions={toLatLng(ring)}
            pathOptions={{ color: z.active ? '#0B5FFF' : '#8A99AE', weight: 2, fillOpacity: z.active ? 0.14 : 0.05, dashArray: z.active ? undefined : '4' }}
          />
        );
      })}

      {draft.length >= 3 && (
        <Polygon positions={toLatLng(draft)} pathOptions={{ color: '#0B5FFF', weight: 2, dashArray: '6', fillOpacity: 0.1 }} />
      )}
      {draft.length === 2 && <Polyline positions={toLatLng(draft)} pathOptions={{ color: '#0B5FFF', dashArray: '6', weight: 2 }} />}
      {draft.map((p, i) => (
        <CircleMarker key={i} center={[p[1], p[0]]} radius={5} pathOptions={{ color: '#0B5FFF', fillColor: '#ffffff', fillOpacity: 1, weight: 2 }} />
      ))}
    </MapContainer>
  );
}
