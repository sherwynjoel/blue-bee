import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { SmsModule } from './auth/sms/sms.module';
import { AuthModule } from './auth/auth.module';
import { OrdersModule } from './orders/orders.module';
import { LogisticsModule } from './logistics/logistics.module';
import { TrackingModule } from './tracking/tracking.module';
import { RealtimeModule } from './realtime/realtime.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DriverModule } from './driver/driver.module';
import { StorageModule } from './media/storage/storage.module';
import { MediaModule } from './media/media.module';
import { CatalogModule } from './catalog/catalog.module';

/**
 * Root module of the Blue Bee modular monolith (PRD §10.3). Phase-1 wires config +
 * the Postgres/Redis infrastructure + health + auth (Increment 2) + orders
 * (Increment 3 — specialty book→intake→quote→approve) + logistics (Increment 4 —
 * Route/RouteStop backbone + §5.4 stop state machine) + tracking (Increment 5 —
 * location ingestion + Redis last-known + Timescale history + scoped reads) + realtime
 * (Increment 6 — Socket.IO scoped channels + signed per-vehicle customer token + fleet
 * channel) + server-side ETA + geofence (Increment 7 — in-house ETA range behind the
 * EtaEstimator seam + geofence events on the realtime channels) + notifications
 * (Increment 8 — matrix-driven engine + outbox delivering customer alerts across the
 * SMS/email/push transport seam, plus device-token registration) + the driver duty-loop
 * surface (Increment 9 — `/v1/driver/*`, the DRIVER-self-scoped read + shift + §5.4 actions
 * the Expo driver app consumes, delegating to the proven logistics services) + the presigned
 * media/storage path (Increment 10 — `StorageModule` global seam over AWS S3/MinIO + `MediaModule`'s
 * `/v1/media/presign|confirm` real upload→confirm→signed-read). Billing lands later.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    RedisModule,
    StorageModule,
    SmsModule,
    AuthModule,
    OrdersModule,
    MediaModule,
    CatalogModule,
    RealtimeModule,
    NotificationsModule,
    TrackingModule,
    LogisticsModule,
    DriverModule,
    HealthModule,
  ],
})
export class AppModule {}
