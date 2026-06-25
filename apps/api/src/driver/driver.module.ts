import { Module } from '@nestjs/common';
import { LogisticsModule } from '../logistics/logistics.module';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

/**
 * DriverModule (Increment 9) — the driver app's duty-loop surface. Additive and isolated: it imports
 * LogisticsModule purely to reuse the proven `ShiftService` + `RouteStopService` (the §5.4 state
 * machine + order-leg wiring), wrapping them with a strict DRIVER-self-ownership boundary. No new
 * schema, no change to the ops endpoints.
 */
@Module({
  imports: [LogisticsModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
