import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { FacilityLinenService } from './facility-linen.service';
import { DriverSoilPickupController, FacilityLinenController, ParLevelController } from './facility-linen.controller';

/**
 * Facility-linen par loop (Track B Phase 2, PRD §2.2/§5.2/§B3) — the rental/par half of the care-home
 * vertical: par levels per site/cost-centre, an append-only on-hand ledger (LinenMovement) + cached
 * on-hand (LinenStock), soiled-cart pickup confirmation, and the pack-to-par load sheet (reuses Manifest).
 * Thin + additive (mirrors CostCentersModule): imports OrdersModule for the shared `AuditService`. The
 * plant production floor (§B3.3/§B3.4), RFID, and par/weight/piece billing stay DEFERRED.
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [FacilityLinenController, ParLevelController, DriverSoilPickupController],
  providers: [FacilityLinenService],
})
export class FacilityLinenModule {}
