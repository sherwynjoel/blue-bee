import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES, type ChatMessageDto } from '@blue-bee/shared';
import { ApiError } from '../api/problem';
import type { ApiClient } from '../api/client';
import { API_BASE_URL } from '../config';
import { ChatOutbox } from './chat-outbox';
import { FileOutboxStore } from './file-outbox-store';
import {
  DriverChatController,
  INITIAL_DRIVER_CHAT_STATE,
  type DriverChatSocketHandlers,
  type DriverChatSocketLike,
  type DriverChatState,
} from './chat-controller';

/** How often to re-attempt the durable queue while mounted (no NetInfo in the driver app). */
const RETRY_INTERVAL_MS = 15_000;

/** Open the SAME `/live/vehicle` channel the customer uses (driver rides the existing gateway). */
function connectChatSocket(baseUrl: string, channelToken: string, handlers: DriverChatSocketHandlers): DriverChatSocketLike {
  const socket = io(`${baseUrl}${WS_NAMESPACES.VEHICLE}`, {
    transports: ['websocket'],
    auth: { token: channelToken },
    reconnection: true,
    forceNew: true,
  });
  socket.on('connect', handlers.onConnect);
  socket.on(WS_EVENTS.CHAT_MESSAGE, (ev: ChatMessageDto) => handlers.onChatMessage(ev));
  socket.on('connect_error', handlers.onConnectError);
  socket.on('disconnect', handlers.onDisconnect);
  return { disconnect: () => socket.disconnect() };
}

/** A definitive client-side rejection (4xx except auth) is permanent — don't retry it forever. */
function isPermanent(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401;
}

export interface UseDriverChat extends DriverChatState {
  send(body: string): void;
  loadOlder(): void;
}

/**
 * React hook for the driver chat screen. Offline-first: sends flow through the durable `ChatOutbox`
 * (persisted via expo-file-system), so a message composed with no signal is queued honestly and
 * synced later. Retry triggers: socket (re)connect (in the controller), app foreground, and a bounded
 * interval — there is no NetInfo in the driver app, so we poll the queue rather than react to the OS.
 */
export function useDriverChat(client: ApiClient, orderId: string, baseUrl: string = API_BASE_URL): UseDriverChat {
  const [state, setState] = useState<DriverChatState>(INITIAL_DRIVER_CHAT_STATE);
  const ctrlRef = useRef<DriverChatController | null>(null);

  useEffect(() => {
    const outbox = new ChatOutbox(orderId, new FileOutboxStore(orderId));
    const ctrl = new DriverChatController({
      fetchHistory: (cursor?: string) => client.getMessages(orderId, { limit: 30, cursor }),
      fetchChannelToken: async () => (await client.getMessagesChannel(orderId)).channelToken,
      connect: (token, handlers) => connectChatSocket(baseUrl, token, handlers),
      outbox,
      sendOne: (item) => client.sendMessage(item.orderId, item.body, item.idempotencyKey),
      isPermanent,
      genIdempotencyKey: () => `chat-${orderId}-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      markRead: async () => {
        await client.markMessagesRead(orderId);
      },
      onState: setState,
    });
    ctrlRef.current = ctrl;
    void ctrl.start();

    // Retry the durable queue when the app returns to the foreground…
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void ctrl.flush();
    });
    // …and on a bounded interval (covers the no-NetInfo case: reconnected but no socket event).
    const timer = setInterval(() => void ctrl.flush(), RETRY_INTERVAL_MS);

    return () => {
      appSub.remove();
      clearInterval(timer);
      ctrl.stop();
      ctrlRef.current = null;
    };
  }, [client, orderId, baseUrl]);

  const send = useCallback((body: string) => void ctrlRef.current?.send(body), []);
  const loadOlder = useCallback(() => void ctrlRef.current?.loadOlder(), []);

  return { ...state, send, loadOlder };
}
