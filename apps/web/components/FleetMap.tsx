'use client';

import 'leaflet/dist/leaflet.css';
import React from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';

export interface MapVehicle {
  vehicleId: string;
  label: string;
  lat: number;
  lng: number;
  live?: boolean;
}

/**
 * The web fleet map — behind a seam (dynamically imported, ssr:false). Real Leaflet +
 * OpenStreetMap tiles (no API key); the tiles pick up the Daylight `--map-tile-filter`
 * (a calm dark map) from globals.css. Vehicles render as branded azure HTML markers; a
 * live-reporting vehicle gets a soft pulse halo. A swap to a Google Maps adapter later
 * stays a drop-in replacement for this component. Default GTA center.
 */
function vehicleIcon(live?: boolean): L.DivIcon {
  const halo = live
    ? '<span style="position:absolute;inset:-7px;border-radius:9999px;background:var(--ring);animation:bb-pulse-ring 2.4s cubic-bezier(.2,.8,.2,1) infinite"></span>'
    : '';
  const dot = `<span style="position:relative;width:16px;height:16px;border-radius:9999px;background:${live ? '#0B5FFF' : '#8A99AE'};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(10,37,64,.35)"></span>`;
  const html = `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:16px;height:16px">${halo}${dot}</span>`;
  return L.divIcon({ html, className: 'bb-vehicle-marker', iconSize: [16, 16], iconAnchor: [8, 8] });
}

export default function FleetMap({ vehicles, height = 560 }: { vehicles: MapVehicle[]; height?: number }): React.ReactElement {
  const center: [number, number] = vehicles.length > 0 ? [vehicles[0]!.lat, vehicles[0]!.lng] : [43.6532, -79.3832];
  return (
    <MapContainer center={center} zoom={11} style={{ height, width: '100%', borderRadius: 16, overflow: 'hidden' }} scrollWheelZoom>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {vehicles.map((v) => (
        <Marker key={v.vehicleId} position={[v.lat, v.lng]} icon={vehicleIcon(v.live)}>
          <Tooltip direction="top" offset={[0, -8]}>
            {v.label} {v.live ? '(live)' : ''}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
