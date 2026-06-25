import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/**
 * MediaModule (Increment 10) — the presigned upload/confirm endpoints. Imports OrdersModule to reuse
 * the proven `OrderAccessService` (ownership) + `AuditService`. The object-storage seam
 * (STORAGE_PROVIDER, MEDIA_CONFIG, MediaSigner) comes from the GLOBAL StorageModule, so there is no
 * import cycle with OrdersModule (which signs photo reads via the same global MediaSigner).
 */
@Module({
  imports: [OrdersModule],
  controllers: [MediaController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
