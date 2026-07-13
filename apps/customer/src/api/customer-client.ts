import type {
  AccountProfileView,
  CreditBalanceView,
  HomeView,
  ApproveQuoteDto,
  BookOrderDto,
  ChatMessageDto,
  ConfirmMediaDto,
  CreatePaymentIntentDto,
  CreateRatingDto,
  CreateSiteDto,
  CustomerSitesResult,
  DeclineQuoteDto,
  PatchRatingDto,
  RatingView,
  DrycleanCatalogView,
  HomeServiceMenuView,
  InvoiceView,
  ListOrdersQuery,
  MarkReadResult,
  MediaResult,
  MembershipsResult,
  MessageListResult,
  MessagesQuery,
  OrderTrackingResult,
  OrderWeightView,
  PaymentIntentResponse,
  PaymentView,
  PickupSlotsResult,
  PresignMediaDto,
  PresignMediaResult,
  ReferralView,
  ReferralsView,
  RedeemJoinCodeDto,
  RedeemResultView,
  ServiceCatalogResult,
  SiteDeactivateResult,
  SiteMutationResult,
  UnreadCountResult,
  UpdateProfileInput,
  UpdateSiteDto,
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

  /** The customer's own sites (row-scoped) — the pickup/delivery address picker. Active only, default first. */
  getSites(): Promise<CustomerSitesResult> {
    return this.request('GET', '/sites');
  }

  // ───────────── pickup availability (Inc-28 — the real time-slot picker) ─────────────

  /**
   * [Inc-28] The day's bookable pickup windows. The SERVER owns the schedule (the founder's saved operating
   * hours, or the labelled default), the business timezone, the lead time, and any capacity cap. The app
   * never invents a window, and never renders a count from `remaining: null` — that means "no cap is
   * configured", not "we counted and it is low".
   *
   * Omit `date` to get the first bookable day. The result's `bookableDates` IS the day strip to render, so a
   * device in another timezone can never offer a day the business is shut. Another account's `siteId` is a
   * 404 (row-scoping is enforced server-side, never assumed here).
   */
  getPickupSlots(date?: string, siteId?: string): Promise<PickupSlotsResult> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (siteId) params.set('siteId', siteId);
    const qs = params.toString();
    return this.request('GET', `/availability/pickup-slots${qs ? `?${qs}` : ''}`);
  }

  // ───────────── saved addresses (Inc-26 — the write side of /sites) ─────────────

  /**
   * [Inc-26] Save a new address. The SERVER geocodes `dto.address` (or trusts `dto.geo` when the customer
   * dropped a pin) and answers serviceability — the app never resolves a coordinate nor decides coverage.
   * An address that cannot be resolved is a 422 `site.geocode_failed` and nothing is saved.
   * Pass a stable `idempotencyKey` so a timeout-then-retry never saves the address twice.
   */
  createSite(dto: CreateSiteDto, idempotencyKey?: string): Promise<SiteMutationResult> {
    return this.request('POST', '/sites', { body: dto, idempotencyKey });
  }

  /**
   * [Inc-26] Edit a saved address. The server re-geocodes only when the address actually changed; another
   * account's site is a 404 (row-scoping is enforced server-side, never assumed here).
   */
  updateSite(siteId: string, dto: UpdateSiteDto, idempotencyKey?: string): Promise<SiteMutationResult> {
    return this.request('PATCH', `/sites/${siteId}`, { body: dto, idempotencyKey });
  }

  /**
   * [Inc-26] Remove a saved address. Soft delete server-side (a past order still references the row), so it
   * simply disappears from `getSites()`. Repeatable: removing an already-removed address succeeds. When the
   * removed address was the default, the server promotes the next one and names it in the result.
   */
  deactivateSite(siteId: string): Promise<SiteDeactivateResult> {
    return this.request('POST', `/sites/${siteId}:deactivate`);
  }

  /** [Inc-21] The customer Home service menu — the 8 top-level service cards (icon/title/description/tags +
   *  pricingModel/unit + founder-set "from" price; NULL price → the card shows "Get a quote"). */
  getServiceMenu(): Promise<HomeServiceMenuView> {
    return this.request('GET', '/catalog/home');
  }

  /** [Inc-17] The visual garment picker (the per-garment drill-in) — categories → items with a photo + a price
   *  the SERVER already resolved for this caller (corporate override or base). Used by the Book flow.
   *  [Inc-38] `cardId` scopes it to the Home card the customer tapped, so one card's picker can never show
   *  another card's garments. */
  getDrycleanCatalog(cardId?: string): Promise<DrycleanCatalogView> {
    return this.request('GET', cardId ? `/catalog/dryclean?cardId=${encodeURIComponent(cardId)}` : '/catalog/dryclean');
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

  /** [Inc-23 P4] The order's authoritative weight + append-only history + the booking estimate (own order). */
  getOrderWeight(orderId: string): Promise<OrderWeightView> {
    return this.request('GET', `/orders/${orderId}/weight`);
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

  // ───────────── ratings / CSAT (Increment 32 — after delivery) ─────────────

  /**
   * Rate a delivered order (1–5 + optional comment). Pass a stable `idempotencyKey` so a timeout/retry
   * replays the first result instead of a 409. Server-authoritative: eligibility (delivered-or-later),
   * ownership, and one-per-order are enforced server-side — 409 (`rating.already_exists`) if already rated.
   */
  submitRating(orderId: string, dto: CreateRatingDto, idempotencyKey?: string): Promise<RatingView> {
    return this.request('POST', `/orders/${orderId}/rating`, { body: dto, idempotencyKey });
  }

  /** Revise your own rating (original submitter, within the edit window). */
  updateRating(orderId: string, dto: PatchRatingDto): Promise<RatingView> {
    return this.request('PATCH', `/orders/${orderId}/rating`, { body: dto });
  }

  /** The order's rating, or 404 (`rating.not_found`) when unrated. Usually unnecessary — `getOrder` embeds it. */
  getRating(orderId: string): Promise<RatingView> {
    return this.request('GET', `/orders/${orderId}/rating`);
  }

  // ───────────── track my truck (Increments 5–7) ─────────────

  /** REST source-of-truth poll: last-known of the order's one vehicle + first ETA + a channelToken. */
  getOrderTracking(orderId: string): Promise<OrderTrackingResult> {
    return this.request('GET', `/orders/${orderId}/tracking`);
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
   * Send a message. Pass a stable `idempotencyKey` so a timeout/offline-composed retry is de-duped
   * server-side. Returns 409 (chat_read_only → ApiError.isConflict) when the order is not in an
   * active delivery window — the screen surfaces the read-only state.
   */
  sendMessage(orderId: string, body: string, idempotencyKey?: string): Promise<ChatMessageDto> {
    return this.request('POST', `/orders/${orderId}/messages`, { body: { body }, idempotencyKey });
  }

  /** The caller's unread count for this order (the badge on the order card). */
  getUnreadCount(orderId: string): Promise<UnreadCountResult> {
    return this.request('GET', `/orders/${orderId}/messages/unread`);
  }

  /** Mark the caller's inbound messages in this order read (clears the badge). Idempotent. */
  markMessagesRead(orderId: string): Promise<MarkReadResult> {
    return this.request('POST', `/orders/${orderId}/messages/read`, { body: {} });
  }

  /**
   * Mint the short-lived signed channel token for the live chat socket (the SAME `/live/vehicle`
   * channel + token as live tracking — no second socket path). Null when the thread is read-only.
   */
  getMessagesChannel(orderId: string): Promise<{ channelToken: string | null; stopId: string | null; vehicleId: string | null }> {
    return this.request('GET', `/orders/${orderId}/messages/channel`);
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

  // ───────────── corporate pricing (Inc-16 — the TTC join-code path; engine shipped in Inc-15) ─────────────

  /**
   * Redeem a corporate join code → a pricing-only membership for the signed-in user (the order then
   * prices on that corporate account's rate card while the member still pays individually). Idempotent;
   * a bad/expired/invalid code is a server 400 → ApiError (the screen surfaces it). Server is the
   * authority — the app never decides pricing.
   */
  redeemJoinCode(dto: RedeemJoinCodeDto): Promise<RedeemResultView> {
    return this.request('POST', '/corporate/redeem', { body: dto });
  }

  /** The signed-in user's OWN corporate memberships (userId-scoped server-side — never another user's). */
  listMyMemberships(): Promise<MembershipsResult> {
    return this.request('GET', '/corporate/memberships');
  }

  // ───────────── account (launch-scaffolding — store-required self-deletion) ─────────────

  /**
   * Permanently delete the signed-in user's OWN account. The server purges PII children + anonymizes
   * the user row (irreversible, audited); the app must then clear the local session (sign out).
   */
  deleteAccount(): Promise<void> {
    return this.request('DELETE', '/account', { body: {} });
  }

  /**
   * [Inc-33] Update the signed-in user's OWN profile (name / email). Self-only + org-scoped server-side.
   * Email is unique per org — a collision is a 409 (`email_taken` → ApiError.isConflict) the screen shows
   * inline. Returns the updated profile (email normalized: trimmed + lowercased); phone is read-only
   * (login identity). Callers should `reloadMe()` after so the rest of the app sees the new name/email.
   */
  updateProfile(input: UpdateProfileInput): Promise<AccountProfileView> {
    return this.request('PATCH', '/account/profile', { body: input });
  }

  // ───────────── referral (Inc-34 — invite + code, reward deferred) ─────────────

  /**
   * The signed-in customer's OWN invite code (minted server-side on first read, stable after) + a
   * `shareUrl` (only when a deep-link base is configured server-side, else null — the app shares the bare
   * code, never a fake domain). Row-scoped to self server-side.
   */
  getReferral(): Promise<ReferralView> {
    return this.request('GET', '/account/referral');
  }

  /** Who joined via my code (name-minimal + count), row-scoped to me server-side. */
  getReferrals(): Promise<ReferralsView> {
    return this.request('GET', '/account/referrals');
  }

  // ───────────── home + credits (Inc-37) ─────────────

  /**
   * [Inc-37] Everything the Home tab renders, in one round trip: the founder's announcement blocks, the
   * customer's REAL credit balance + ledger, the live referral reward terms (`reward.enabled === false` ⇒ the
   * app must promise NOTHING), recent orders and account identity. All server-resolved — the app invents none
   * of it.
   */
  getHome(): Promise<HomeView> {
    return this.request('GET', '/home');
  }

  /** The signed-in customer's REAL credit balance (SUM of an append-only ledger) + every entry. Self-scoped. */
  getCredits(): Promise<CreditBalanceView> {
    return this.request('GET', '/account/credits');
  }
}
