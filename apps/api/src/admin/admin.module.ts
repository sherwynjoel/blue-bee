import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

/**
 * Admin module (Increment 16, PRD Epic B6.2) — the OWNER-gated, org-scoped, audited admin surface
 * (users/roles, devices, driver→vehicle assignment, notification-config + audit-log viewers). Thin +
 * additive (mirrors Inc-15 AnalyticsModule / Inc-14a OwnerModule). Imports OrdersModule to reuse the
 * exported `AuditService` (one audit writer across the codebase).
 */
@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
