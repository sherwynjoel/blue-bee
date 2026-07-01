import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  messagesQuerySchema,
  sendMessageSchema,
  type MessagesQuery,
  type SendMessageDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ChatService } from './chat.service';

/**
 * In-app order chat endpoints (Increment 18, PRD §7A A6.1 / §9.6). A per-order, two-party
 * customer ↔ assigned-driver text thread, live only during the active delivery window.
 *
 * RBAC: the global JwtAuthGuard + RolesGuard already protect every route. @Roles here is the
 * COARSE gate — only customer-side (RESIDENTIAL_CUSTOMER / ACCOUNT_ADMIN / ACCOUNT_STAFF) and
 * DRIVER roles reach the handler; org-wide staff (OWNER/DISPATCHER/CSR/…) get 403 forbidden_role,
 * so owner/console chat visibility stays OUT (deferred moderation surface). The FINE, per-order
 * participant check (this account's member OR this order's assigned driver) lives in ChatService.
 * The IdempotencyInterceptor makes POST /messages replay-safe (an offline-composed retry with an
 * Idempotency-Key is de-duplicated).
 */
@ApiTags('chat')
@ApiBearerAuth()
@Controller('orders')
@UseInterceptors(IdempotencyInterceptor)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get(':id/messages')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.DRIVER)
  @ApiOperation({ summary: 'Order chat history (newest-first, cursor pagination) + unread count + open state. Always readable by a participant, even after the stop completes.' })
  list(
    @CurrentUser() p: RequestPrincipal,
    @Param('id') id: string,
    @Query(new ZodBody(messagesQuerySchema)) q: MessagesQuery,
  ) {
    return this.chat.listMessages(p, id, q);
  }

  @Get(':id/messages/unread')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.DRIVER)
  @ApiOperation({ summary: "The caller's unread message count for this order (the badge)." })
  unread(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.chat.unreadCount(p, id);
  }

  @Get(':id/messages/channel')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.DRIVER)
  @ApiOperation({ summary: 'Mint the short-lived signed channel token to open the /live/vehicle socket for live chat (null when read-only). Same token/namespace as live tracking — no second socket path.' })
  channel(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.chat.channelToken(p, id);
  }

  @Post(':id/messages')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.DRIVER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a message to the order thread. 409 chat_read_only when the order is not in an active delivery window. Idempotent (Idempotency-Key).' })
  send(
    @CurrentUser() p: RequestPrincipal,
    @Param('id') id: string,
    @Body(new ZodBody(sendMessageSchema)) dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(p, id, dto);
  }

  @Post(':id/messages/read')
  @Roles(RoleType.RESIDENTIAL_CUSTOMER, RoleType.ACCOUNT_ADMIN, RoleType.ACCOUNT_STAFF, RoleType.DRIVER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark the caller's inbound messages in this order as read (clears the unread badge). Idempotent." })
  markRead(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.chat.markRead(p, id);
  }
}
