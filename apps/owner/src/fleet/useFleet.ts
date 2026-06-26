import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES } from '@blue-bee/shared';
import type { ApiClient } from '../api/client';
import { API_BASE_URL } from '../config';
import {
  FleetController,
  INITIAL_FLEET_STATE,
  type FleetSocketHandlers,
  type FleetState,
  type SocketLike,
} from './fleet-controller';

/** Poll cadence (ms) for the REST source-of-truth while the live socket is down (degraded). */
const DEGRADED_POLL_MS = 15_000;

/**
 * Open the REAL `/live/fleet` Socket.IO channel for the org fleet. The access JWT rides in the
 * HANDSHAKE auth (`auth.token`) — never the URL/query (the gateway reads handshake auth, to keep
 * tokens out of logs; the §6 contract). The socket is server-bound to the org fleet room; the client
 * only listens. WS namespaces are NOT under the `/v1` REST prefix, so we use the bare origin + ns.
 */
function connectFleetSocket(baseUrl: string, token: string, handlers: FleetSocketHandlers): SocketLike {
  const socket = io(`${baseUrl}${WS_NAMESPACES.FLEET}`, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    forceNew: true,
  });
  socket.on('connect', handlers.onConnect);
  socket.on(WS_EVENTS.POSITION, handlers.onPosition);
  socket.on('connect_error', handlers.onConnectError);
  socket.on('disconnect', handlers.onDisconnect);
  return { disconnect: () => socket.disconnect() };
}

export interface UseFleet extends FleetState {
  reload(): void;
}

/**
 * React hook for the owner fleet board. Wires the framework-agnostic `FleetController` (REST-truth /
 * WS-optimisation state machine) to the REAL owner client (`GET /fleet/live`) and the REAL socket.io
 * `/live/fleet` channel, and polls REST while degraded so the board never goes stale or blank.
 */
export function useFleet(client: ApiClient, baseUrl: string = API_BASE_URL): UseFleet {
  const [state, setState] = useState<FleetState>(INITIAL_FLEET_STATE);
  const ctrlRef = useRef<FleetController | null>(null);

  useEffect(() => {
    let token: string | null = null;
    const ctrl = new FleetController({
      fetchFleet: () => client.fleetLive(),
      connect: (handlers) => {
        if (!token) {
          // No access token → no live channel; degrade to REST polling (never blank).
          queueMicrotask(() => handlers.onConnectError({ message: 'no access token' }));
          return { disconnect: () => undefined };
        }
        return connectFleetSocket(baseUrl, token, handlers);
      },
      onState: setState,
    });
    ctrlRef.current = ctrl;
    void (async () => {
      token = await client.accessToken();
      await ctrl.start();
    })();
    return () => {
      ctrl.stop();
      ctrlRef.current = null;
    };
  }, [client, baseUrl]);

  // While the live socket is down, keep the REST snapshot fresh (the socket auto-reconnects).
  useEffect(() => {
    if (state.phase !== 'degraded') return;
    const id = setInterval(() => void ctrlRef.current?.refreshSnapshot(), DEGRADED_POLL_MS);
    return () => clearInterval(id);
  }, [state.phase]);

  const reload = useCallback(() => void ctrlRef.current?.refreshSnapshot(), []);

  return { ...state, reload };
}
