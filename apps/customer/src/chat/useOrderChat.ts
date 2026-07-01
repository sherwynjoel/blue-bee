import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { WS_EVENTS, WS_NAMESPACES, type ChatMessageDto } from '@blue-bee/shared';
import type { CustomerApiClient } from '../api/customer-client';
import { API_BASE_URL } from '../config';
import { ChatController, INITIAL_CHAT_STATE, type ChatSocketHandlers, type ChatSocketLike, type ChatState } from './chat-controller';

/**
 * Open the REAL `/live/vehicle` Socket.IO channel for live chat — the SAME namespace + signed
 * channel token the live-tracking channel uses (no second socket path). Token in the HANDSHAKE auth
 * (never the URL). The socket is server-bound to the order room by the gateway; the client only
 * listens for `chat:message`. WS namespaces are NOT under the `/v1` REST prefix.
 */
function connectChatSocket(baseUrl: string, channelToken: string, handlers: ChatSocketHandlers): ChatSocketLike {
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

export interface UseOrderChat extends ChatState {
  send(body: string): void;
  loadOlder(): void;
}

/**
 * React hook for the customer chat screen. Wires the framework-agnostic `ChatController` (REST-truth
 * / WS-optimisation) to the real customer client (history/send/mark-read/channel) and the real
 * socket.io channel. A stable idempotency key per composed message makes a send retry-safe.
 */
export function useOrderChat(client: CustomerApiClient, orderId: string, baseUrl: string = API_BASE_URL): UseOrderChat {
  const [state, setState] = useState<ChatState>(INITIAL_CHAT_STATE);
  const ctrlRef = useRef<ChatController | null>(null);

  useEffect(() => {
    const ctrl = new ChatController({
      fetchHistory: (cursor?: string) => client.getMessages(orderId, { limit: 30, cursor }),
      fetchChannelToken: async () => (await client.getMessagesChannel(orderId)).channelToken,
      connect: (token, handlers) => connectChatSocket(baseUrl, token, handlers),
      // A per-message idempotency key: a retry of the SAME composed message is de-duped server-side.
      send: (body: string) => client.sendMessage(orderId, body, `chat-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      markRead: async () => {
        await client.markMessagesRead(orderId);
      },
      onState: setState,
    });
    ctrlRef.current = ctrl;
    void ctrl.start();
    return () => {
      ctrl.stop();
      ctrlRef.current = null;
    };
  }, [client, orderId, baseUrl]);

  const send = useCallback((body: string) => void ctrlRef.current?.send(body), []);
  const loadOlder = useCallback(() => void ctrlRef.current?.loadOlder(), []);

  return { ...state, send, loadOlder };
}
