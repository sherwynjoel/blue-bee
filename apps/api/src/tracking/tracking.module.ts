import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { TRACKING_CONFIG, loadTrackingConfig } from '../config/tracking.config';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GpsHistoryService } from './gps-history.service';
import { IngestionService } from './ingestion.service';
import { LastKnownStore } from './last-known.store';
import { TrackingReadService } from './tracking-read.service';
import { EtaService } from './eta.service';
import { GeofenceService } from './geofence.service';
import { TrackingPredictionService } from './tracking-prediction.service';
import { PostgisEtaEstimator } from './postgis-eta.estimator';
import { ETA_ESTIMATOR } from './eta-estimator';
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
 * the signed per-vehicle channel token.
 *
 * Increment 7 — the predictive layer: on each genuine advance the IngestionService calls
 * `TrackingPredictionService`, which recomputes the active-stop ETA (`EtaService`, behind the
 * in-house `ETA_ESTIMATOR` seam bound to `PostgisEtaEstimator` — NO external maps API) and
 * evaluates geofence (`GeofenceService` → durable `GeofenceEvent` rows + realtime emit). All ETA/
 * geofence tunables come from `TRACKING_CONFIG`.
 *
 * Increment 8 — imports `NotificationsModule`: a NEWLY-written geofence crossing is handed to
 * `NotificationService.dispatchGeofence` (degradation-wrapped) to raise customer alerts. The
 * dispatch is the last, most-optional step — a notification failure never undoes the geofence write,
 * the ETA, or `POST /locations:batch`.
 */
@Module({
  imports: [OrdersModule, RealtimeModule, NotificationsModule],
  controllers: [LocationsController, FleetLiveController, OrderTrackingController],
  providers: [
    IngestionService,
    GpsHistoryService,
    LastKnownStore,
    TrackingReadService,
    IdempotencyInterceptor,
    { provide: TRACKING_CONFIG, useFactory: loadTrackingConfig },
    PostgisEtaEstimator,
    { provide: ETA_ESTIMATOR, useExisting: PostgisEtaEstimator },
    EtaService,
    GeofenceService,
    TrackingPredictionService,
  ],
})
export class TrackingModule {}
