import type {
  ApproveQuoteDto,
  BookOrderDto,
  ConfirmMediaDto,
  CreatePaymentIntentDto,
  CustomerSitesResult,
  DeclineQuoteDto,
  InvoiceView,
  ListOrdersQuery,
  MediaResult,
  OrderTrackingResult,
  PaymentIntentResponse,
  PaymentView,
  PresignMediaDto,
  PresignMediaResult,
  ServiceCatalogResult,
} from '@blue-bee/shared';
import { ApiClient } from '@blue-bee/api-client';
import type { OrderDetail, OrderListResult } from './types';

/**
 * The Blue Bee customer-app API client — extends the shared transport (`@blue-bee/api-client`: auth,
 * single-flight 401→refresh→retry, problem+json→ApiError, push device-tokens) with the customer
 * domain surface: book + read/list orders, approve/decline the quote, track-my-truck, and the
 * Increment-10 media presign/confirm. Every contract comes from `@blue-bee/shared`; row-scoping /
 * ownership is enforced SERVER-side (the JWT scope), never assumed here.
 */
export class CustomerApiClient extends ApiClient {
  // ───────────── catalog (Increment 11 booking context) ─────────────

  /** The org's bookable services (to pick a serviceId). */
  getServices(): Promise<ServiceCatalogResult> {
    return this.request('GET', '/services');
  }

  /** The customer's own sites (row-scoped) — the pickup/delivery address picker. */
  getSites(): Promise<CustomerSitesResult> {
    return this.request('GET', '/sites');
  }

  // ───────────── orders (Increment 3) ─────────────

  listOrders(query: ListOrdersQuery = { limit: 20 }): Promise<OrderListResult> {
    const params = new URLSearchParams();
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.status) params.set('status', query.status);
    const qs = params.toString();
    return this.request('GET', `/orders${qs ? `?${qs}` : ''}`);
  }

  getOrder(orderId: string): Promise<OrderDetail> {
    return this.request('GET', `/orders/${orderId}`);
  }

  /** Book a specialty job. Pass a stable `idempotencyKey` so a timeout/retry never double-books. */
  book(dto: BookOrderDto, idempotencyKey?: string): Promise<OrderDetail> {
    return this.request('POST', '/orders', { body: dto, idempotencyKey });
  }

  // ───────────── quote approve / decline (COLON-action routes, server-authoritative) ─────────────

  approveQuote(orderId: string, dto: ApproveQuoteDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${orderId}/quote:approve`, { body: dto });
  }

  declineQuote(orderId: string, dto: DeclineQuoteDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${orderId}/quote:decline`, { body: dto });
  }

  // ───────────── track my truck (Increments 5–7) ─────────────

  /** REST source-of-truth poll: last-known of the order's one vehicle + first ETA + a channelToken. */
  getOrderTracking(orderId: string): Promise<OrderTrackingResult> {
    return this.request('GET', `/orders/${orderId}/tracking`);
  }

  // ───────────── pay (Increment 12 — Stripe PaymentSheet; client gets the client_secret only) ─────────────

  /** Create/re-attempt the PaymentIntent for an approved order. Amount is computed server-side from
   *  the approved quote (never sent by the client). Idempotency-Key makes a retry replay-safe. */
  createPaymentIntent(orderId: string, idempotencyKey?: string, dto: CreatePaymentIntentDto = {}): Promise<PaymentIntentResponse> {
    return this.request('POST', `/orders/${orderId}/payment-intent`, { body: dto, idempotencyKey });
  }

  /** The order's latest payment — polled after PaymentSheet to confirm the WEBHOOK-confirmed success. */
  getPayment(orderId: string): Promise<PaymentView | null> {
    return this.request('GET', `/orders/${orderId}/payment`);
  }

  /** The order's invoice/receipt (or null). */
  getInvoice(orderId: string): Promise<InvoiceView | null> {
    return this.request('GET', `/orders/${orderId}/invoice`);
  }

  // ───────────── media (Increment 10) ─────────────

  presignMedia(dto: PresignMediaDto): Promise<PresignMediaResult> {
    return this.request('POST', '/media/presign', { body: dto });
  }

  confirmMedia(dto: ConfirmMediaDto): Promise<MediaResult> {
    return this.request('POST', '/media/confirm', { body: dto });
  }

  // ───────────── account (launch-scaffolding — store-required self-deletion) ─────────────

  /**
   * Permanently delete the signed-in user's OWN account. The server purges PII children + anonymizes
   * the user row (irreversible, audited); the app must then clear the local session (sign out).
   */
  deleteAccount(): Promise<void> {
    return this.request('DELETE', '/account', { body: {} });
  }
}
