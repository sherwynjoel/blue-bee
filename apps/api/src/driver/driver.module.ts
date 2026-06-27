import { Module } from '@nestjs/common';
import { LogisticsModule } from '../logistics/logistics.module';
import { MediaModule } from '../media/media.module';
import { OrdersModule } from '../orders/orders.module';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

/**
 * DriverModule (Increment 9 + the Increment-17 POD-capture flow) — the driver app's duty-loop surface.
 * Additive and isolated: imports LogisticsModule to reuse the proven `ShiftService` + `RouteStopService`
 * (the §5.4 state machine + order-leg wiring), MediaModule to reuse the proven presign/HEAD-verify/
 * signed-read object mechanics for POD photos+signature (authorized by stop ownership, NOT the customer
 * order-write path), and OrdersModule for the shared `AuditService`. All wrapped with a strict
 * DRIVER-self-ownership boundary. No new schema, no change to the ops endpoints.
 */
@Module({
  imports: [LogisticsModule, MediaModule, OrdersModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
