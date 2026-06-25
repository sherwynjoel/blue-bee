import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES } from '@blue-bee/shared';
import type { CustomerApiClient } from '../api/customer-client';
import { API_BASE_URL } from '../config';
import {
  INITIAL_TRACKING_STATE,
  TrackingController,
  type SocketHandlers,
  type SocketLike,
  type TrackingState,
} from './tracking-controller';

/** Poll cadence (ms) for the REST source-of-truth while the live socket is down (degraded). */
const DEGRADED_POLL_MS = 12_000;

/**
 * Open the REAL `/live/vehicle` Socket.IO channel for one vehicle/stop. The channel token rides in
 * the HANDSHAKE auth (`auth.token`) — never the URL/query (the gateway only reads handshake auth, to
 * keep tokens out of logs). The socket is server-bound to exactly one vehicle room; the client never
 * emits — it only listens. WS namespaces are NOT under the `/v1` REST prefix, so we use the bare
 * origin + namespace.
 */
function connectVehicleSocket(baseUrl: string, channelToken: string, handlers: SocketHandlers): SocketLike {
  const socket = io(`${baseUrl}${WS_NAMESPACES.VEHICLE}`, {
    transports: ['websocket'],
    auth: { token: channelToken },
    reconnection: true,
    forceNew: true,
  });
  socket.on('connect', handlers.onConnect);
  socket.on(WS_EVENTS.POSITION, handlers.onPosition);
  socket.on(WS_EVENTS.ETA, handlers.onEta);
  socket.on(WS_EVENTS.GEOFENCE, handlers.onGeofence);
  socket.on(WS_EVENTS.CHANNEL_CLOSED, handlers.onChannelClosed);
  socket.on('connect_error', handlers.onConnectError);
  socket.on('disconnect', handlers.onDisconnect);
  return { disconnect: () => socket.disconnect() };
}

export interface UseVehicleTracking extends TrackingState {
  retry(): void;
}

/**
 * React hook for the customer "track my truck" screen. Wires the framework-agnostic
 * `TrackingController` (the §12.3 REST-truth / WS-optimisation state machine) to the REAL customer
 * client (`GET /orders/:id/tracking`) and the REAL socket.io channel, and polls REST while degraded.
 */
export function useVehicleTracking(
  client: CustomerApiClient,
  orderId: string,
  baseUrl: string = API_BASE_URL,
): UseVehicleTracking {
  const [state, setState] = useState<TrackingState>(INITIAL_TRACKING_STATE);
  const ctrlRef = useRef<TrackingController | null>(null);

  useEffect(() => {
    const ctrl = new TrackingController({
      fetchTracking: () => client.getOrderTracking(orderId),
      connect: (token, handlers) => connectVehicleSocket(baseUrl, token, handlers),
      onState: setState,
    });
    ctrlRef.current = ctrl;
    void ctrl.start();
    return () => {
      ctrl.stop();
      ctrlRef.current = null;
    };
  }, [client, orderId, baseUrl]);

  // While the live socket is down, keep the REST last-known fresh (the socket auto-reconnects).
  useEffect(() => {
    if (state.phase !== 'degraded') return;
    const id = setInterval(() => void ctrlRef.current?.refreshSnapshot(), DEGRADED_POLL_MS);
    return () => clearInterval(id);
  }, [state.phase]);

  const retry = useCallback(() => {
    void ctrlRef.current?.retry();
  }, []);

  return { ...state, retry };
}
