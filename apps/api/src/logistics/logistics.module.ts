import { Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { OrdersModule } from '../orders/orders.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { FleetController } from './fleet.controller';
import { DriverService, ShiftService, VehicleService } from './fleet.service';
import { LogisticsAccessService } from './logistics-access.service';
import { ManifestService } from './manifest.service';
import { OptimizerService } from './optimizer.service';
import { RouteStopStateMachine } from './route-stop-state-machine.service';
import { RouteStopService } from './route-stop.service';
import { RouteStopsController } from './route-stops.controller';
import { RouteService } from './route.service';
import { RoutesController } from './routes.controller';

/**
 * Logistics module (Increment 4, BUILD-PLAN item 6) — Route → RouteStop backbone +
 * the §5.4 stop state machine + the in-house PostGIS sequencer + manifests. Imports
 * OrdersModule for the OrderStateMachine + OrderAccessService (pickup-leg wiring) and
 * the shared AuditService. Stops before the live tracking gateway (Increment 5):
 * GpsPing/GeofenceEvent/ProofOfDelivery stay modelled but unused.
 */
@Module({
  imports: [OrdersModule, RealtimeModule],
  controllers: [FleetController, RoutesController, RouteStopsController],
  providers: [
    VehicleService,
    DriverService,
    ShiftService,
    RouteService,
    RouteStopService,
    RouteStopStateMachine,
    OptimizerService,
    ManifestService,
    LogisticsAccessService,
    IdempotencyInterceptor,
  ],
  // Exported so the Increment-9 DriverModule can reuse the proven §5.4 + shift-lifecycle services
  // behind a driver-self-ownership boundary (no duplication of the state machines). OptimizerService
  // is exported so the Track-A RecurringModule reuses the ONE in-house PostGIS sequencer (no duplicate).
  exports: [ShiftService, RouteStopService, OptimizerService],
})
export class LogisticsModule {}
