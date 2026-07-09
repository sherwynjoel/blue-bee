'use client';

import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES, type LiveWeightEvent, type OrderWeightView } from '@blue-bee/shared';
import { API_BASE_URL } from './config';
import type { ConsoleApiClient } from './api-client';

export interface UseOrderWeightLive {
  weight: OrderWeightView | null;
  loading: boolean;
  error: string | null;
  /** The fleet socket is connected (live push active). */
  live: boolean;
  /** The most recent live weight push for this order (drives a subtle "just updated" affordance). */
  lastEvent: LiveWeightEvent | null;
  refresh: () => void;
}

/**
 * [Inc-23 P3] The order's authoritative weight, LIVE. `GET /v1/orders/:id/weight` (REST) is the source of
 * truth; the console rides the SAME `WS /live/fleet` fleet channel it already uses for positions and, on a
 * `weight` event for THIS order, re-reads the authoritative view. So a driver's approval (or an owner
 * override) appears without a refresh; a dropped socket just leaves the panel on the last REST snapshot.
 */
export function useOrderWeightLive(client: ConsoleApiClient, orderId: string): UseOrderWeightLive {
  const [weight, setWeight] = useState<OrderWeightView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastEvent, setLastEvent] = useState<LiveWeightEvent | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // REST fetch (source of truth) on mount, on manual refresh, and after a live event.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client
      .orderWeight(orderId)
      .then((w) => {
        if (!cancelled) {
          setWeight(w);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the weight.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, orderId, nonce]);

  // Fleet socket: a WEIGHT event for THIS order → re-read the authoritative view (REST stays authoritative).
  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;
    (async () => {
      const token = await client.accessToken();
      if (cancelled || !token) return;
      socket = io(`${API_BASE_URL}${WS_NAMESPACES.FLEET}`, { transports: ['websocket'], reconnection: true, auth: { token } });
      socket.on('connect', () => setLive(true));
      socket.on('disconnect', () => setLive(false));
      socket.on('connect_error', () => setLive(false));
      socket.on(WS_EVENTS.WEIGHT, (ev: LiveWeightEvent) => {
        if (ev.orderId === orderId) {
          setLastEvent(ev);
          setNonce((n) => n + 1);
        }
      });
    })();
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [client, orderId]);

  return { weight, loading, error, live, lastEvent, refresh };
}
