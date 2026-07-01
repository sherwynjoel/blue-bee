import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CommsChannel, type Message } from '@prisma/client';
import {
  CHAT_ERRORS,
  RoleScope,
  type ChatMessageDto,
  type MarkReadResult,
  type MessageListResult,
  type MessagesQuery,
  type SendMessageDto,
  type UnreadCountResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ACCOUNT_ROLES } from '../auth/rbac/policy';
import { selectActiveStop } from '../tracking/tracking-util';
import { ChannelTokenService } from '../realtime/channel-token.service';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';

/** The order's single active stop, resolved with the driver/vehicle a chat needs. */
interface ActiveStopContext {
  id: string;
  vehicleId: string | null;
  driverId: string | null;
  driverUserId: string | null;
}

/**
 * Who the caller is on this order's thread + the live-window state, resolved once per request.
 *  • `side` — 'customer' (an ACCOUNT member of the order's account) or 'driver' (the Driver
 *    profile assigned to a stop on the order). A user who is neither NEVER reaches here (404).
 *  • `open` — the order has an active stop WITH an assigned driver (someone to talk to). When
 *    false the thread is READ-ONLY: history GET works, POST is rejected 409.
 */
interface ThreadContext {
  order: { id: string; orgId: string; accountId: string; createdBy: string | null };
  side: 'customer' | 'driver';
  /** The caller's Driver.id when side === 'driver' (else null). */
  driverId: string | null;
  activeStop: ActiveStopContext | null;
  open: boolean;
}

/**
 * In-app chat domain service (Increment 18) — the FIRST consumer of the long-dormant `Message`
 * model. A per-order, two-party (customer ↔ assigned-driver) text thread that is LIVE only during
 * the order's active delivery window (selectActiveStop !== null, PRD §6.1/§6.2) and READ-ONLY
 * after the stop completes. Reuses: the `Message` row (thread_id = order_id per order, §9.6), the
 * active-stop selector (tracking-util), the signed channel token + `/live/vehicle` gateway for
 * live delivery, and the driver-ownership pattern from DriverService.
 *
 * Tenancy is enforced HERE, not by the scoped-Prisma extension: `Message` is a user-owned model
 * (only org-scoped by the extension) and a DRIVER principal has NO account scope at all, so every
 * query carries an EXPLICIT `org_id` and access is gated by an explicit participant check
 * (account-membership OR assigned-driver) — exactly what scoped-prisma.ts documents for
 * Message/Notification/Device. Org-wide staff (OWNER/DISPATCHER/CSR) are NOT participants — the
 * thread is visible to exactly the order's customer + its assigned driver.
 *
 * The service NEVER writes order/stop status — it only READS the §5.4 lifecycle to gate sends.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelTokens: ChannelTokenService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /** GET /v1/orders/:id/messages — a page of the thread (newest-first) + the caller's live state. */
  async listMessages(p: RequestPrincipal, orderId: string, query: MessagesQuery): Promise<MessageListResult> {
    const ctx = await this.resolveThread(p, orderId);
    const rows = await this.prisma.message.findMany({
      where: { orgId: p.orgId, orderId },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      messages: page.map((m) => this.toDto(m)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
      unreadCount: await this.countUnread(p, orderId),
      open: ctx.open,
    };
  }

  /** GET /v1/orders/:id/messages/unread — the lightweight per-order badge count. */
  async unreadCount(p: RequestPrincipal, orderId: string): Promise<UnreadCountResult> {
    await this.resolveThread(p, orderId);
    return { orderId, unreadCount: await this.countUnread(p, orderId) };
  }

  /** POST /v1/orders/:id/messages/read — flip the caller's inbound unread messages to read. Idempotent. */
  async markRead(p: RequestPrincipal, orderId: string): Promise<MarkReadResult> {
    await this.resolveThread(p, orderId);
    const res = await this.prisma.message.updateMany({
      where: { orgId: p.orgId, orderId, toUserId: p.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { orderId, read: res.count, unreadCount: await this.countUnread(p, orderId) };
  }

  /**
   * POST /v1/orders/:id/messages — persist + broadcast one message. Rejected 409 (chat_read_only)
   * unless the order is in its active delivery window; the driver sender must be the CURRENTLY
   * active stop's driver (a past pickup driver cannot post during a later delivery leg). The
   * message row is immutable once written — only its `read_at` ever changes.
   */
  async sendMessage(p: RequestPrincipal, orderId: string, dto: SendMessageDto): Promise<ChatMessageDto> {
    const ctx = await this.resolveThread(p, orderId);
    if (!ctx.open || !ctx.activeStop) {
      throw new ConflictException({
        error: CHAT_ERRORS.CHAT_READ_ONLY,
        message: 'chat is read-only: the order is not in an active delivery window',
      });
    }

    let toUserId: string | null;
    if (ctx.side === 'driver') {
      // Only the currently-assigned driver of the active stop may post (not a past/other driver).
      if (ctx.driverId !== ctx.activeStop.driverId) {
        throw new ConflictException({
          error: CHAT_ERRORS.CHAT_READ_ONLY,
          message: 'chat is read-only: you are not the driver on this order\'s active stop',
        });
      }
      toUserId = await this.resolveCustomerUserId(ctx.order);
    } else {
      // Customer → the active stop's driver (guaranteed present because ctx.open === true).
      toUserId = ctx.activeStop.driverUserId;
    }

    const row = await this.prisma.message.create({
      data: {
        orgId: p.orgId,
        // One thread per order: thread_id is deterministically the order id (§9.6 "thread per order").
        threadId: orderId,
        orderId,
        fromUserId: p.userId,
        toUserId,
        channel: CommsChannel.IN_APP,
        body: dto.body,
        createdBy: p.userId,
      },
    });
    const message = this.toDto(row);
    // Live delivery is an OPTIMIZATION over the persisted history: emit to the order room so the
    // counterpart (and the sender's other devices) refine instantly; an offline client backfills
    // via GET. Room-scoped emit only — never a global broadcast.
    this.publisher.publishChatMessage(p.orgId, orderId, message);
    return message;
  }

  /**
   * GET /v1/orders/:id/messages/channel — mint the short-lived signed channel token that opens the
   * SAME `/live/vehicle` socket the live-tracking channel uses (no second socket path / no new token
   * kind). Returns null when there is no active stop/vehicle to bind (read-only window → REST only).
   * Works for BOTH the customer and the assigned driver; the WS handshake re-checks live state.
   */
  async channelToken(
    p: RequestPrincipal,
    orderId: string,
  ): Promise<{ channelToken: string | null; stopId: string | null; vehicleId: string | null }> {
    const ctx = await this.resolveThread(p, orderId);
    if (!ctx.open || !ctx.activeStop || !ctx.activeStop.vehicleId) {
      return { channelToken: null, stopId: null, vehicleId: null };
    }
    const token = this.channelTokens.mint({
      orgId: p.orgId,
      vehicleId: ctx.activeStop.vehicleId,
      orderId,
      stopId: ctx.activeStop.id,
      sub: p.userId,
      // chat-authorized: resolveThread above proved this caller is a participant (customer or assigned
      // driver). This is what lets the gateway add them to the order chat room — a plain tracking token
      // (org-wide staff can mint one) never carries this, so it can track the vehicle but not read chat.
      chat: true,
    });
    return { channelToken: token, stopId: ctx.activeStop.id, vehicleId: ctx.activeStop.vehicleId };
  }

  // ─────────────────────────────── internals ───────────────────────────────

  /** Unread FOR THE CALLER in this order = inbound messages (to_user = me) not yet read. */
  private countUnread(p: RequestPrincipal, orderId: string): Promise<number> {
    return this.prisma.message.count({
      where: { orgId: p.orgId, orderId, toUserId: p.userId, readAt: null },
    });
  }

  private toDto(m: Message): ChatMessageDto {
    return {
      id: m.id,
      orderId: m.orderId ?? '',
      threadId: m.threadId,
      fromUserId: m.fromUserId,
      toUserId: m.toUserId,
      body: m.body,
      sentAt: m.sentAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
    };
  }

  /**
   * Resolve the caller's participation + the order's live-window state. Loads the order org-scoped
   * (404 if cross-org / nonexistent), classifies the caller as the order's customer (account member)
   * or its assigned driver, and 404s any non-participant (no existence leak). Then computes the
   * active stop (with driver/vehicle) so callers get one consistent live-window view.
   */
  private async resolveThread(p: RequestPrincipal, orderId: string): Promise<ThreadContext> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, orgId: p.orgId },
      select: { id: true, orgId: true, accountId: true, createdBy: true },
    });
    if (!order) {
      throw new NotFoundException({ error: CHAT_ERRORS.ORDER_NOT_FOUND, message: `Order ${orderId} not found` });
    }

    // Customer side: an ACCOUNT member of THIS order's account. Org-wide staff carry no accountIds,
    // so they are excluded here — chat is visible to exactly the customer + the assigned driver.
    const isCustomer = p.accountIds.includes(order.accountId);

    // Driver side: the caller's Driver profile is assigned (via route) to some stop on this order.
    let driverId: string | null = null;
    if (!isCustomer) {
      const driver = await this.prisma.driver.findFirst({
        where: { userId: p.userId, orgId: p.orgId },
        select: { id: true },
      });
      if (driver) {
        const own = await this.prisma.routeStop.findFirst({
          where: { orderId, orgId: p.orgId, route: { driverId: driver.id } },
          select: { id: true },
        });
        if (own) driverId = driver.id;
      }
    }

    if (!isCustomer && !driverId) {
      // Not the customer, not an assigned driver → 404 (do not leak the order's existence).
      throw new NotFoundException({ error: CHAT_ERRORS.ORDER_NOT_FOUND, message: `Order ${orderId} not found` });
    }

    const activeStop = await this.resolveActiveStop(order.orgId, orderId);
    // Open (postable) iff there is an active stop AND it has an assigned driver to converse with.
    const open = activeStop !== null && activeStop.driverUserId !== null;

    return { order, side: isCustomer ? 'customer' : 'driver', driverId, activeStop, open };
  }

  /** The order's single active stop (privacy: one vehicle, §6.2) + its driver/vehicle. */
  private async resolveActiveStop(orgId: string, orderId: string): Promise<ActiveStopContext | null> {
    const stops = await this.prisma.routeStop.findMany({
      where: { orderId, orgId },
      select: {
        id: true,
        seq: true,
        status: true,
        route: { select: { status: true, vehicleId: true, driverId: true, driver: { select: { userId: true } } } },
      },
    });
    const active = selectActiveStop(stops);
    if (!active) return null;
    return {
      id: active.id,
      vehicleId: active.route.vehicleId,
      driverId: active.route.driverId,
      driverUserId: active.route.driver?.userId ?? null,
    };
  }

  /**
   * The customer-side participant a driver's message is addressed to. Prefer a CUSTOMER-role member
   * of the order's account (the booker `createdBy` may be a staff CSR who booked on the customer's
   * behalf, and staff are not chat participants); fall back to `createdBy` only when the account has
   * no account-scoped member. For the residential one-user-per-account case this is exact; the
   * per-recipient unread badge tracks this canonical user — see the Inc-18 handoff.
   */
  private async resolveCustomerUserId(order: { orgId: string; accountId: string; createdBy: string | null }): Promise<string | null> {
    const role = await this.prisma.userRole.findFirst({
      where: { orgId: order.orgId, scope: RoleScope.ACCOUNT, scopeId: order.accountId, role: { in: [...ACCOUNT_ROLES] } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true },
    });
    return role?.userId ?? order.createdBy ?? null;
  }
}
