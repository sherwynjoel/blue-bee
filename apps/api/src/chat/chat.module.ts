import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

/**
 * In-app chat module (Increment 18) — the per-order customer ↔ assigned-driver text thread.
 * Reuses the global PrismaModule/RedisModule + the global JwtAuthGuard → RolesGuard, and imports
 * RealtimeModule for the signed channel-token mint (ChannelTokenService) + the room-scoped live
 * emit (RealtimePublisher). No new socket path, no new DB table — it is the first consumer of the
 * dormant `Message` model. Push/SMS signalling stays OUT (parked track): new-message signalling is
 * in-app only (socket + unread count).
 */
@Module({
  imports: [RealtimeModule],
  controllers: [ChatController],
  providers: [ChatService, IdempotencyInterceptor],
})
export class ChatModule {}
