import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { ChannelTokenService } from './channel-token.service';
import { RealtimeAccessService } from './realtime-access.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime-publisher.service';

/**
 * Realtime gateway module (Increment 6, BUILD-PLAN item 7 — realtime layer). The Socket.IO
 * gateway + the thin realtime abstraction (`RealtimePublisher`) + the signed-channel-token
 * mint/verify. Imports AuthModule for `TokenService` (fleet-channel JWT auth + revocation)
 * and its own `JwtModule` for the dedicated channel-token signer. Exports the publisher
 * (consumed by tracking ingestion to push positions, and by logistics to tear channels down
 * on stop/shift end) and the token service (consumed by the tracking read to mint tokens).
 * STOPS BEFORE ETA + geofence (Increment 7).
 */
@Module({
  imports: [JwtModule.register({}), AuthModule],
  providers: [RealtimeGateway, RealtimePublisher, ChannelTokenService, RealtimeAccessService],
  exports: [RealtimePublisher, ChannelTokenService],
})
export class RealtimeModule {}
