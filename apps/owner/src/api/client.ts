import type {
  ApproveQuoteDto,
  DeclineQuoteDto,
  FleetLiveResult,
  OwnerApprovalsResult,
  OwnerExceptionsResult,
  OwnerTodayResult,
} from '@blue-bee/shared';
import { ApiClient as BaseApiClient } from '@blue-bee/api-client';
import type { OrderDetail, RouteDetail, RouteListResult } from './types';

/**
 * The Blue Bee owner-app API client — extends the shared transport (`@blue-bee/api-client`: auth,
 * single-flight 401→refresh→retry, problem+json→ApiError, push device-tokens) with the OWNER cockpit
 * surface (PRD §4.3/§7C). It is mostly a CONSUMER of proven endpoints: the live fleet (`/fleet/live`
 * + the `WS /live/fleet` access token), the three thin owner reads (Increment 14a), the quote
 * approve/decline action, and the read-only drill-through (`/orders/:id`, `/routes/:id`). All scoping
 * + RBAC are enforced SERVER-side (the JWT's OWNER role + org); the app never assumes them.
 */
export class ApiClient extends BaseApiClient {
  /** The current access token — for the `WS /live/fleet` handshake (the token rides in `auth.token`). */
  accessToken(): Promise<string | null> {
    return this.store.getAccess();
  }

  // ───────────── live fleet (Increments 5–7) ─────────────

  /** REST source-of-truth snapshot of all the org's vehicles' last-known positions + next-stop ETAs. */
  fleetLive(): Promise<FleetLiveResult> {
    return this.request('GET', '/fleet/live');
  }

  // ───────────── owner cockpit reads (Increment 14a — thin additive OWNER-scoped) ─────────────

  /** PRD §7C C2 — today's glanceable numbers (server-aggregated). */
  today(): Promise<OwnerTodayResult> {
    return this.request('GET', '/owner/today');
  }

  /** PRD §7C C3 — pending quote approvals. */
  approvals(): Promise<OwnerApprovalsResult> {
    return this.request('GET', '/owner/approvals');
  }

  /** PRD §7C C4 — the exceptions feed (failed/skipped stops, held orders, disputes, failed payments). */
  exceptions(): Promise<OwnerExceptionsResult> {
    return this.request('GET', '/owner/exceptions');
  }

  // ───────────── approvals action (reuses the proven colon-action routes, server-authoritative) ─────────────

  /** Approve a pending quote. A 409 means the server's atomic claim moved (expired/already acted) → re-sync. */
  approveQuote(orderId: string, dto: ApproveQuoteDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${orderId}/quote:approve`, { body: dto });
  }

  declineQuote(orderId: string, dto: DeclineQuoteDto = {}): Promise<OrderDetail> {
    return this.request('POST', `/orders/${orderId}/quote:decline`, { body: dto });
  }

  // ───────────── read-only drill-through (PRD §7C C5 — same objects as the console) ─────────────

  getOrder(orderId: string): Promise<OrderDetail> {
    return this.request('GET', `/orders/${orderId}`);
  }

  getRoute(routeId: string): Promise<RouteDetail> {
    return this.request('GET', `/routes/${routeId}`);
  }

  /** List routes (optionally by status) — used to resolve a tapped vehicle's active route. */
  listRoutes(status?: string): Promise<RouteListResult> {
    const qs = status ? `?status=${encodeURIComponent(status)}&limit=100` : '?limit=100';
    return this.request('GET', `/routes${qs}`);
  }

  // ───────────── account (launch-scaffolding — store-required self-deletion) ─────────────

  /** Permanently delete the signed-in user's OWN account (server purges PII + anonymizes); then sign out. */
  deleteAccount(): Promise<void> {
    return this.request('DELETE', '/account', { body: {} });
  }
}
