import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GpsHistoryService } from './gps-history.service';
import { IngestionService } from './ingestion.service';
import { LastKnownStore } from './last-known.store';
import { TrackingReadService } from './tracking-read.service';
import { FleetLiveController } from './fleet-live.controller';
import { LocationsController } from './locations.controller';
import { OrderTrackingController } from './order-tracking.controller';

/**
 * Tracking module (Increment 5, BUILD-PLAN item 7 — ingestion + storage slice) — the
 * location data path: `POST /locations:batch` ingestion (shift-gated, scoped, deduped) →
 * Redis last-known (hot) + Timescale GpsPing history → scoped REST reads (`GET /fleet/live`,
 * `GET /orders/:id/tracking`). Reuses the global PrismaModule/RedisModule, the
 * JwtAuthGuard→RolesGuard (Increment 2), and OrdersModule's OrderAccessService (customer
 * order scoping) + AuditService. Imports RealtimeModule (Increment 6): ingestion publishes
 * each genuine last-known advance to the Socket.IO fan-out, and the order-tracking read mints
 * the signed per-vehicle channel token. STOPS BEFORE server-side ETA + geofence (Increment 7).
 */
@Module({
  imports: [OrdersModule, RealtimeModule],
  controllers: [LocationsController, FleetLiveController, OrderTrackingController],
  providers: [IngestionService, GpsHistoryService, LastKnownStore, TrackingReadService, IdempotencyInterceptor],
})
export class TrackingModule {}
