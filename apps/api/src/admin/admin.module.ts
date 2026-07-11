import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { ServiceZonesModule } from '../service-zones/service-zones.module';
import { AdminController } from './admin.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AdminService } from './admin.service';
import { AdminCustomersService } from './admin-customers.service';

/**
 * Admin module (Increment 16, PRD Epic B6.2) — the OWNER-gated, org-scoped, audited admin surface
 * (users/roles, devices, driver→vehicle assignment, notification-config + audit-log viewers). Thin +
 * additive (mirrors Inc-15 AnalyticsModule / Inc-14a OwnerModule). Imports OrdersModule to reuse the
 * exported `AuditService` (one audit writer across the codebase).
 *
 * [Inc-27] Adds the read-only, OWNER/CSR-gated customer-360 (`/v1/admin/customers`). It imports
 * ServiceZonesModule for `ServiceZonesService.isServiceable`, so the console reports a saved address's
 * coverage from the same PostGIS gate the booking path uses — never a second, drifting implementation.
 */
@Module({
  imports: [PrismaModule, OrdersModule, ServiceZonesModule],
  controllers: [AdminController, AdminCustomersController],
  providers: [AdminService, AdminCustomersService],
})
export class AdminModule {}
