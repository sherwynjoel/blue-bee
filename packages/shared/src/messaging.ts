/**
 * In-app chat contract (Increment 18) — Zod request schemas + DTO/response types for the
 * per-order customer↔driver message thread (PRD §7A A6.1 "two-way thread per order", §9.6
 * Message entity, §6.2 privacy scoping reused via the live-tracking channel).
 *
 * Single source of truth shared by the API (validation + response shaping) and the customer/
 * driver apps. The chat REUSES the dormant `Message` model (id, thread_id, order_id, from_user,
 * to_user, channel, body, sent_at) — Inc-18 adds only a `read_at` read-state column + an
 * `order_id` index (additive migration). Real-time delivery reuses the existing Socket.IO
 * `/live/vehicle` gateway + signed channel token (see tracking.ts) — no second socket path.
 *
 * Scope: text only; live (postable) ONLY during the order's active delivery window
 * (selectActiveStop !== null), read-only after the stop completes. New-message signalling is
 * IN-APP ONLY this increment (socket + unread count) — push (Expo/Twilio) is a parked track,
 * so there is NO push send here (a notification hook is intentionally deferred, not faked).
 */
import { z } from 'zod';

// ─────────────────────────── send (POST /v1/orders/:id/messages) ───────────────────────────

/**
 * Send one text message to the order thread. `body` is trimmed and bounded; a message is
 * IMMUTABLE once sent (only its read-state flag ever changes). Pair with an `Idempotency-Key`
 * header (§11.1) so an offline-composed retry is de-duplicated server-side.
 */
export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'message body is required').max(4000),
});
export type SendMessageDto = z.infer<typeof sendMessageSchema>;

// ─────────────────────── history (GET /v1/orders/:id/messages) — cursor pagination ───────────────────────

/**
 * Cursor pagination over an order's thread (§11.1). Newest-first: the first page is the most
 * recent `limit` messages; `nextCursor` walks BACKWARD into older history (scroll-up-to-load).
 * `cursor` is the id of the last row of the previous page (matches the orders list idiom).
 */
export const messagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

// ─────────────────────────────── wire shapes (responses + WS) ───────────────────────────────

/**
 * One persisted chat message on the wire. `fromUserId` identifies the author so a client can
 * align its own bubbles (fromUserId === my userId) without a viewer-relative server flag — the
 * SAME shape is returned by REST history AND pushed as the `chat:message` WS event, so a live
 * message and a backfilled one are indistinguishable to the app. `readAt` is the recipient's
 * read timestamp (null = unread by its recipient).
 */
export interface ChatMessageDto {
  id: string;
  orderId: string;
  threadId: string;
  fromUserId: string | null;
  toUserId: string | null;
  body: string;
  /** ISO-8601 send time (immutable). */
  sentAt: string;
  /** ISO-8601 when the recipient read it, or null. */
  readAt: string | null;
}

/**
 * GET /v1/orders/:id/messages result — a page of the thread plus the caller's live state.
 *  • `unreadCount` — messages addressed to the CALLER in this order with readAt null (the badge).
 *  • `open` — is the order currently in its active delivery window (composer enabled)? False ⇒
 *    the thread is read-only (the stop completed / no active stop) and POST returns 409.
 */
export interface MessageListResult {
  messages: ChatMessageDto[];
  nextCursor: string | null;
  hasMore: boolean;
  unreadCount: number;
  open: boolean;
}

/** GET /v1/orders/:id/messages/unread — the lightweight per-order badge count for the caller. */
export interface UnreadCountResult {
  orderId: string;
  unreadCount: number;
}

/** POST /v1/orders/:id/messages/read — mark the caller's inbound messages read. Idempotent. */
export interface MarkReadResult {
  orderId: string;
  /** How many previously-unread messages this call flipped to read. */
  read: number;
  unreadCount: number;
}

/**
 * Payload of the `chat:message` WS event (WS_EVENTS.CHAT_MESSAGE, tracking.ts). Emitted to the
 * order room on the `/live/vehicle` namespace when a message is persisted, so the counterpart
 * (and the sender's other devices) see it live. It is the SAME `ChatMessageDto` REST returns —
 * the socket is an OPTIMIZATION over the persisted REST history (a dropped/offline client
 * backfills on reconnect; the emit is never the only delivery path).
 */
export type ChatMessageEvent = ChatMessageDto;

// ─────────────────────────── error codes (problem+json `title`) ───────────────────────────

export const CHAT_ERRORS = {
  /** Order does not exist, or the caller is not a participant (customer of the order / its
   *  assigned driver). Returned as 404 to avoid leaking an order's existence to non-participants. */
  ORDER_NOT_FOUND: 'order_not_found',
  /** 409 — the thread is read-only: the order is not in an active delivery window (no active
   *  stop / the stop completed / no assigned driver to talk to). History GET still works. */
  CHAT_READ_ONLY: 'chat_read_only',
  /** 404 — a DRIVER access token with no Driver profile row (cannot resolve the driver side). */
  DRIVER_PROFILE_MISSING: 'driver_profile_missing',
} as const;
export type ChatErrorCode = (typeof CHAT_ERRORS)[keyof typeof CHAT_ERRORS];
