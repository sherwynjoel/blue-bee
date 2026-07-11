import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReferralService } from './referral.service';

/**
 * Referral module (Increment 34) — invite + code + attribution (reward deferred). Owns the
 * {@link ReferralService}. It writes its append-only audit rows directly via Prisma (not AuditService),
 * so it depends on NOTHING but PrismaModule — which is what lets AuthModule import it for the Inc-35
 * signup-capture without a dependency cycle (AuthModule ← Referral ← Orders ← Realtime ← Auth). Exports
 * the service for the account surface (customer endpoints) and the auth/registration path.
 */
@Module({
  imports: [PrismaModule],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
