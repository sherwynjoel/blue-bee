import { Global, Module } from '@nestjs/common';
import { MEDIA_CONFIG, loadMediaConfig } from '../../config/media.config';
import { STORAGE_PROVIDER } from './storage-provider';
import { S3StorageProvider } from './s3-storage.provider';
import { MediaSigner } from './media-signer';

/**
 * GLOBAL storage module (Increment 10). Provides the object-storage seam (MEDIA_CONFIG +
 * STORAGE_PROVIDER = the real AWS-SDK S3/MinIO impl) and the MediaSigner app-wide, so the media
 * upload path AND any read path can sign URLs without import cycles. The concrete S3 provider is the
 * only place the AWS SDK is touched — swap it to bind a different store.
 */
@Global()
@Module({
  providers: [
    { provide: MEDIA_CONFIG, useFactory: () => loadMediaConfig() },
    { provide: STORAGE_PROVIDER, useClass: S3StorageProvider },
    MediaSigner,
  ],
  exports: [MEDIA_CONFIG, STORAGE_PROVIDER, MediaSigner],
})
export class StorageModule {}
