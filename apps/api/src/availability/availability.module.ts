import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

/**
 * Pickup availability (Increment 28) — the customer read side of the org's operating schedule. The WRITE
 * side (the founder's console control) lives on `AdminController`, next to the other OWNER-gated settings.
 *
 * No local providers beyond the service: `PrismaService` comes from the @Global `PrismaModule`, and the
 * schedule reader (`common/org-schedule.ts`) + slot math (`pickup-slots.ts`) are pure functions, not
 * injectables. There is nothing to audit here — this module only reads.
 */
@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
