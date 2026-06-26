'use client';

import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES, type LivePositionEvent } from '@blue-bee/shared';
import { API_BASE_URL } from './config';
import type { ConsoleApiClient } from './api-client';

export type WsStatus = 'connecting' | 'live' | 'degraded';

/**
 * Live fleet WS (Increment 13) — connects `WS /live/fleet` with the access JWT in the handshake auth
 * (the Inc-6 contract) and overlays `position` events on the REST snapshot. The WS is an OPTIMIZATION:
 * REST `GET /fleet/live` stays the source of truth, so a failed/dropped socket simply leaves the board
 * on the snapshot (status 'degraded') — never a blank screen.
 */
export function useFleetSocket(client: ConsoleApiClient): { status: WsStatus; positions: Record<string, LivePositionEvent> } {
  const [status, setStatus] = useState<WsStatus>('connecting');
  const [positions, setPositions] = useState<Record<string, LivePositionEvent>>({});

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    (async () => {
      const token = await client.accessToken();
      if (cancelled) return;
      if (!token) {
        setStatus('degraded');
        return;
      }
      socket = io(`${API_BASE_URL}${WS_NAMESPACES.FLEET}`, { transports: ['websocket'], reconnection: true, auth: { token } });
      socket.on('connect', () => setStatus('live'));
      socket.on('connect_error', () => setStatus('degraded'));
      socket.on('disconnect', () => setStatus('degraded'));
      socket.on(WS_EVENTS.POSITION, (p: LivePositionEvent) => {
        setPositions((prev) => ({ ...prev, [p.vehicleId]: p }));
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [client]);

  return { status, positions };
}
