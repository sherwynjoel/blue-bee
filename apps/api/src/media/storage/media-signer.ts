import { Inject, Injectable } from '@nestjs/common';
import { MEDIA_CONFIG, type MediaConfig } from '../../config/media.config';
import { STORAGE_PROVIDER, type StorageProvider } from './storage-provider';

/**
 * Mints short-lived signed GET URLs for stored media (§14). Lives in the GLOBAL StorageModule so BOTH
 * the MediaService and any read path (e.g. the order-graph photo reads in OrdersService) can sign a
 * photo WITHOUT a module import cycle. A photo with a `storageKey` gets a fresh presigned GET; a
 * legacy external-reference photo (`url` only) returns its url; otherwise null.
 */
@Injectable()
export class MediaSigner {
  constructor(
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  async signedGet(photo: { storageKey: string | null; url: string | null }): Promise<string | null> {
    if (photo.storageKey) return this.storage.presignGet(photo.storageKey, this.config.presignGetTtlSec);
    return photo.url ?? null;
  }
}
