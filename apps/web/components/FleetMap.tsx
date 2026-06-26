'use client';

import 'leaflet/dist/leaflet.css';
import React from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';

export interface MapVehicle {
  vehicleId: string;
  label: string;
  lat: number;
  lng: number;
  live?: boolean;
}

/**
 * The web fleet map (Increment 13) — behind a seam (dynamically imported, ssr:false). Real Leaflet +
 * OpenStreetMap tiles (no API key). CircleMarkers (no icon assets) per vehicle; a swap to a Google
 * Maps JS adapter later is a drop-in replacement for this component. Default GTA center.
 */
export default function FleetMap({ vehicles, height = 560 }: { vehicles: MapVehicle[]; height?: number }): React.ReactElement {
  const center: [number, number] = vehicles.length > 0 ? [vehicles[0]!.lat, vehicles[0]!.lng] : [43.6532, -79.3832];
  return (
    <MapContainer center={center} zoom={11} style={{ height, width: '100%', borderRadius: 12 }} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {vehicles.map((v) => (
        <CircleMarker key={v.vehicleId} center={[v.lat, v.lng]} radius={9} pathOptions={{ color: v.live ? '#1a7f37' : '#1f6feb', fillColor: v.live ? '#1a7f37' : '#1f6feb', fillOpacity: 0.8 }}>
          <Tooltip>
            {v.label} {v.live ? '(live)' : ''}
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
