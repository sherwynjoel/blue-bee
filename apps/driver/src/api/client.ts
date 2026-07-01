import type {
  CaptureProofOfDeliveryDto,
  ChatMessageDto,
  DriverAssignment,
  DriverStopAction,
  LocationBatchDto,
  LocationBatchResult,
  MarkReadResult,
  MessageListResult,
  MessagesQuery,
  PresignMediaResult,
  PresignPodMediaDto,
  ProofOfDeliveryView,
  StopActionDto,
  StopExceptionDto,
  UnreadCountResult,
} from '@blue-bee/shared';
import { ApiClient as BaseApiClient } from '@blue-bee/api-client';

/**
 * The Blue Bee driver-app API client — extends the shared transport (`@blue-bee/api-client`: auth,
 * single-flight 401→refresh→retry, problem+json→ApiError, push device-tokens) with the Increment-9
 * `/v1/driver/*` duty loop + `POST /v1/locations:batch`. The shared base is reused 1:1 by the
 * customer app; only these driver-specific endpoints live here.
 */
export class ApiClient extends BaseApiClient {
  // ───────────── driver duty loop (Increment 9) ─────────────

  getAssignment(): Promise<DriverAssignment> {
    return this.request('GET', '/driver/assignment');
  }

  startShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/start`, { body: {} });
  }

  endShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/end`, { body: {} });
  }

  /** Drive a §5.4 stop transition. fail/skip carry a reason; the rest an optional note. */
  stopAction(stopId: string, action: DriverStopAction, body: StopActionDto | StopExceptionDto = {}): Promise<unknown> {
    return this.request('POST', `/driver/stops/${stopId}/${action}`, { body });
  }

  // ───────────── proof of delivery (Increment 17) ─────────────

  /** Presign a POD photo/signature upload for MY delivery stop (the order is resolved from the stop). */
  presignPodMedia(stopId: string, dto: PresignPodMediaDto): Promise<PresignMediaResult> {
    return this.request('POST', `/driver/stops/${stopId}/pod/presign`, { body: dto });
  }

  /** Capture POD (confirmed photo(s) + signature + geo) for MY delivery stop. Idempotent on the stop. */
  captureProofOfDelivery(stopId: string, dto: CaptureProofOfDeliveryDto): Promise<ProofOfDeliveryView> {
    return this.request('POST', `/driver/stops/${stopId}/proof-of-delivery`, { body: dto });
  }

  /** Read MY stop's captured proof of delivery (signed reads). */
  getProofOfDelivery(stopId: string): Promise<ProofOfDeliveryView> {
    return this.request('GET', `/driver/stops/${stopId}/proof-of-delivery`);
  }

  // ───────────── in-app chat (Increment 18 — per-order customer ↔ assigned-driver thread) ─────────────

  /** A page of the order's chat thread (newest-first) + the caller's unread count + `open` (composer). */
  getMessages(orderId: string, query: MessagesQuery = { limit: 30 }): Promise<MessageListResult> {
    const params = new URLSearchParams();
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    const qs = params.toString();
    return this.request('GET', `/orders/${orderId}/messages${qs ? `?${qs}` : ''}`);
  }

  /**
   * Send a message. `idempotencyKey` (stable per composed message) makes an offline-queued retry
   * safe — a re-send of the SAME message is de-duped server-side. 409 (chat_read_only) when the
   * stop is no longer active.
   */
  sendMessage(orderId: string, body: string, idempotencyKey?: string): Promise<ChatMessageDto> {
    return this.request('POST', `/orders/${orderId}/messages`, { body: { body }, idempotencyKey });
  }

  /** The caller's unread count for this order. */
  getUnreadCount(orderId: string): Promise<UnreadCountResult> {
    return this.request('GET', `/orders/${orderId}/messages/unread`);
  }

  /** Mark the caller's inbound messages in this order read. Idempotent. */
  markMessagesRead(orderId: string): Promise<MarkReadResult> {
    return this.request('POST', `/orders/${orderId}/messages/read`, { body: {} });
  }

  /** Mint the short-lived signed channel token for the live chat socket (same channel as tracking). */
  getMessagesChannel(orderId: string): Promise<{ channelToken: string | null; stopId: string | null; vehicleId: string | null }> {
    return this.request('GET', `/orders/${orderId}/messages/channel`);
  }

  // ───────────── location ingestion (Increment 5) ─────────────

  postLocations(batch: LocationBatchDto): Promise<LocationBatchResult> {
    return this.request('POST', '/locations:batch', { body: batch });
  }

  // ───────────── account (launch-scaffolding — store-required self-deletion) ─────────────

  /** Permanently delete the signed-in user's OWN account (server purges PII + anonymizes); then sign out. */
  deleteAccount(): Promise<void> {
    return this.request('DELETE', '/account', { body: {} });
  }
}
