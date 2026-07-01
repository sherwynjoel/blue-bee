import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Photo } from '@prisma/client';
import {
  CATALOG_ERRORS,
  MEDIA_ERRORS,
  MediaUploadStatus,
  PhotoKind,
  POD_ERRORS,
  type CatalogImagePresignResult,
  type ConfirmMediaDto,
  type MediaResult,
  type PresignCatalogImageDto,
  type PresignMediaDto,
  type PresignMediaResult,
  type PresignPodMediaDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { OrderAccessService } from '../orders/order-access.service';
import { AuditService } from '../orders/audit.service';
import { MEDIA_CONFIG, type MediaConfig } from '../config/media.config';
import { STORAGE_PROVIDER, type StorageProvider } from './storage/storage-provider';
import { MediaSigner } from './storage/media-signer';

/** content-type → file extension (cosmetic; the key is what matters). */
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * The real presigned media path (Increment 10). Two phases:
 *   • presign — authorize the target (the caller must own the order/item), validate content-type +
 *     size against config, mint an org-namespaced unguessable key, record a PENDING MediaUpload
 *     intent, and return a short-lived presigned PUT URL. The client uploads bytes directly.
 *   • confirm — load the intent (proving the caller presigned THIS key in THEIR org), HEAD-verify the
 *     real object (exists + content-type + size match the declared values), then create the Photo and
 *     flip the intent CONFIRMED. Idempotent on the key.
 * Reads return a freshly-minted, short-lived signed GET URL (§14) — never a raw key or public link.
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrderAccessService,
    private readonly audit: AuditService,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly signer: MediaSigner,
  ) {}

  // ───────────────────────────── presign ─────────────────────────────

  async presign(principal: RequestPrincipal, dto: PresignMediaDto): Promise<PresignMediaResult> {
    this.assertContentType(dto.contentType);
    if (dto.byteSize > this.config.maxBytes) {
      throw new BadRequestException({ error: MEDIA_ERRORS.TOO_LARGE, message: `declared size ${dto.byteSize} exceeds max ${this.config.maxBytes}` });
    }
    // Authorize the target: the caller must own the order (and the item, if given). Throws 403/404.
    if (dto.itemId) await this.access.requireItemForWrite(principal, dto.orderId, dto.itemId);
    else await this.access.requireOrderForWrite(principal, dto.orderId);

    const storageKey = this.newKey(principal.orgId, dto.kind, dto.contentType);
    await this.prisma.mediaUpload.create({
      data: {
        orgId: principal.orgId,
        storageKey,
        kind: dto.kind,
        contentType: dto.contentType,
        byteSize: dto.byteSize,
        orderId: dto.orderId,
        itemId: dto.itemId ?? null,
        createdBy: principal.userId,
      },
    });
    const uploadUrl = await this.storage.presignPut(storageKey, dto.contentType, dto.byteSize, this.config.presignPutTtlSec);
    return { uploadUrl, storageKey, contentType: dto.contentType, expiresInSec: this.config.presignPutTtlSec, maxBytes: this.config.maxBytes };
  }

  // ───────────────────────────── confirm (standalone) ─────────────────────────────

  /** Confirm a presigned upload → create the Photo. Idempotent: re-confirming a key returns the same row. */
  async confirm(principal: RequestPrincipal, dto: ConfirmMediaDto): Promise<MediaResult> {
    const intent = await this.requireIntent(principal, dto.storageKey);

    // Idempotency: already confirmed → return the existing photo (no duplicate, no re-upload).
    if (intent.status === MediaUploadStatus.CONFIRMED && intent.photoId) {
      const existing = await this.prisma.photo.findFirst({ where: { id: intent.photoId, orgId: principal.orgId } });
      if (existing) return this.toMediaResult(existing);
    }

    await this.reauthorize(principal, intent);
    const verified = await this.headVerify(intent);

    let photo: Photo;
    try {
      photo = await this.prisma.$transaction(async (tx) => {
        const created = await tx.photo.create({
          data: {
            orgId: intent.orgId,
            itemId: intent.itemId,
            orderId: intent.orderId,
            kind: intent.kind,
            storageKey: intent.storageKey,
            contentType: verified.contentType,
            sizeBytes: verified.sizeBytes,
            ...(dto.takenAt ? { takenAt: new Date(dto.takenAt) } : {}),
            createdBy: principal.userId,
          },
        });
        if (dto.geo) await this.writeGeo(tx, created.id, dto.geo.lat, dto.geo.lng);
        await this.markConfirmed(intent.id, created.id, tx);
        await this.audit.record(
          { orgId: intent.orgId, actorId: principal.userId, entity: 'Photo', entityId: created.id, action: 'PHOTO_ADDED', after: { kind: intent.kind, storageKey: intent.storageKey, sizeBytes: verified.sizeBytes } },
          tx,
        );
        return created;
      });
    } catch (err) {
      // Concurrent double-confirm: the unique storage_key makes the loser's create fail (P2002).
      // That's the idempotency guarantee — return the Photo the winner created (no duplicate, no 500).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.photo.findFirst({ where: { storageKey: intent.storageKey, orgId: principal.orgId } });
        if (existing) return this.toMediaResult(existing);
      }
      throw err;
    }
    return this.toMediaResult(photo);
  }

  private async markConfirmed(intentId: string, photoId: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.mediaUpload.updateMany({ where: { id: intentId, status: MediaUploadStatus.PENDING }, data: { status: MediaUploadStatus.CONFIRMED, photoId } });
  }

  // ───────────────────────────── driver POD (stop-scoped, Increment 17) ─────────────────────────────

  /**
   * Presign a POD upload for a stop the DRIVER owns. DriverService.assertOwnStop has ALREADY proven
   * ownership (route.driverId + org), so this deliberately SKIPS the OrderAccessService order-write
   * check — a driver is not the order's account-writer — and authorizes via the stop's order instead.
   * The customer order-ownership presign path is untouched (no widened hole). Same allow-list + size +
   * unguessable org-namespaced key + PENDING-intent discipline as the customer presign; kind is POD.
   */
  async presignForStop(principal: RequestPrincipal, orderId: string, dto: PresignPodMediaDto): Promise<PresignMediaResult> {
    this.assertContentType(dto.contentType);
    if (dto.byteSize > this.config.maxBytes) {
      throw new BadRequestException({ error: MEDIA_ERRORS.TOO_LARGE, message: `declared size ${dto.byteSize} exceeds max ${this.config.maxBytes}` });
    }
    const storageKey = this.newKey(principal.orgId, PhotoKind.POD, dto.contentType);
    await this.prisma.mediaUpload.create({
      data: { orgId: principal.orgId, storageKey, kind: PhotoKind.POD, contentType: dto.contentType, byteSize: dto.byteSize, orderId, createdBy: principal.userId },
    });
    const uploadUrl = await this.storage.presignPut(storageKey, dto.contentType, dto.byteSize, this.config.presignPutTtlSec);
    return { uploadUrl, storageKey, contentType: dto.contentType, expiresInSec: this.config.presignPutTtlSec, maxBytes: this.config.maxBytes };
  }

  /**
   * Confirm a POD upload the driver presigned for THIS stop's order → HEAD-verify the real object +
   * create the POD Photo (kind POD). Authorized by stop-ownership (proven upstream) AND the intent's
   * order must match the stop's order + the intent must be POD-kind (so a key from another stop/order/
   * kind can't be smuggled in). Idempotent on the key (a re-confirm returns the same Photo). Returns
   * the Photo row so the POD writer can link it (set podId). NEVER trusts a client-supplied URL.
   */
  async confirmForStop(principal: RequestPrincipal, storageKey: string, expectedOrderId: string): Promise<Photo> {
    const intent = await this.requireIntent(principal, storageKey);
    if (intent.orderId !== expectedOrderId || intent.kind !== PhotoKind.POD) {
      throw new BadRequestException({ error: POD_ERRORS.MEDIA_NOT_CONFIRMED, message: 'that upload was not presigned as POD media for this stop' });
    }
    if (intent.status === MediaUploadStatus.CONFIRMED && intent.photoId) {
      const existing = await this.prisma.photo.findFirst({ where: { id: intent.photoId, orgId: principal.orgId } });
      if (existing) return existing;
    }
    const verified = await this.headVerify(intent);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.photo.create({
          data: { orgId: intent.orgId, orderId: intent.orderId, kind: PhotoKind.POD, storageKey: intent.storageKey, contentType: verified.contentType, sizeBytes: verified.sizeBytes, createdBy: principal.userId },
        });
        await this.markConfirmed(intent.id, created.id, tx);
        await this.audit.record(
          { orgId: intent.orgId, actorId: principal.userId, entity: 'Photo', entityId: created.id, action: 'PHOTO_ADDED', after: { kind: PhotoKind.POD, storageKey: intent.storageKey, sizeBytes: verified.sizeBytes } },
          tx,
        );
        return created;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.photo.findFirst({ where: { storageKey: intent.storageKey, orgId: principal.orgId } });
        if (existing) return existing;
      }
      throw err;
    }
  }

  /** Mint a fresh short-lived signed GET for a confirmed POD Photo (§14) — used to build the POD view. */
  signedGetFor(photo: Photo): Promise<string | null> {
    return this.signer.signedGet(photo);
  }

  // ───────────────────────────── dry-clean catalog image (org-scoped, Increment 17) ─────────────────────────────

  /**
   * Presign a CATALOG item photo (owner/finance — gated at the controller). Same allow-list + size cap +
   * unguessable org-namespaced key + PENDING-intent discipline as every other presign; the ONLY difference
   * is there is no order/item to own (a catalog image is org-level), so no OrderAccess check. Reuses the
   * exact storage seam — this is NOT a second media path.
   */
  async presignCatalogImage(principal: RequestPrincipal, dto: PresignCatalogImageDto): Promise<CatalogImagePresignResult> {
    this.assertContentType(dto.contentType);
    if (dto.byteSize > this.config.maxBytes) {
      throw new BadRequestException({ error: MEDIA_ERRORS.TOO_LARGE, message: `declared size ${dto.byteSize} exceeds max ${this.config.maxBytes}` });
    }
    const storageKey = this.newKey(principal.orgId, PhotoKind.CATALOG, dto.contentType);
    await this.prisma.mediaUpload.create({
      data: { orgId: principal.orgId, storageKey, kind: PhotoKind.CATALOG, contentType: dto.contentType, byteSize: dto.byteSize, createdBy: principal.userId },
    });
    const uploadUrl = await this.storage.presignPut(storageKey, dto.contentType, dto.byteSize, this.config.presignPutTtlSec);
    return { uploadUrl, storageKey, contentType: dto.contentType, expiresInSec: this.config.presignPutTtlSec, maxBytes: this.config.maxBytes };
  }

  /**
   * Verify a catalog image the admin presigned+PUT for THIS org, then mark the intent CONFIRMED. HEAD-
   * verifies the real object exists + matches the declared content-type/size (a bad object is deleted +
   * rejected). Returns the verified storageKey the caller stores on `Service.imageKey`. No Photo row (a
   * catalog image is not an order-custody artifact). Idempotent: re-confirming a CONFIRMED key is a no-op.
   */
  async confirmCatalogImage(principal: RequestPrincipal, storageKey: string): Promise<string> {
    const intent = await this.requireIntent(principal, storageKey);
    if (intent.kind !== PhotoKind.CATALOG) {
      throw new BadRequestException({ error: CATALOG_ERRORS.IMAGE_NOT_UPLOADED, message: 'that upload was not presigned as a catalog image' });
    }
    if (intent.status === MediaUploadStatus.CONFIRMED) return storageKey;
    await this.headVerify(intent); // exists + content-type/size match (deletes a bad object + throws otherwise)
    await this.prisma.mediaUpload.updateMany({ where: { id: intent.id, orgId: principal.orgId, status: MediaUploadStatus.PENDING }, data: { status: MediaUploadStatus.CONFIRMED } });
    return storageKey;
  }

  // ───────────────────────────── signed reads (§14) ─────────────────────────────

  /** Build the response shape with a freshly-minted short-lived signed GET URL (via MediaSigner). */
  async toMediaResult(photo: Photo): Promise<MediaResult> {
    return {
      id: photo.id,
      kind: photo.kind as unknown as PhotoKind,
      storageKey: photo.storageKey,
      contentType: photo.contentType,
      sizeBytes: photo.sizeBytes,
      downloadUrl: await this.signer.signedGet(photo),
      orderId: photo.orderId,
      itemId: photo.itemId,
      takenAt: photo.takenAt.toISOString(),
      createdAt: photo.createdAt.toISOString(),
    };
  }

  // ───────────────────────────── internals ─────────────────────────────

  private assertContentType(contentType: string): void {
    if (!this.config.allowedContentTypes.includes(contentType.toLowerCase())) {
      throw new BadRequestException({ error: MEDIA_ERRORS.UNSUPPORTED_CONTENT_TYPE, message: `content type ${contentType} is not allowed` });
    }
  }

  private newKey(orgId: string, kind: PhotoKind, contentType: string): string {
    const ext = EXT[contentType.toLowerCase()] ?? 'bin';
    return `org/${orgId}/${kind.toLowerCase()}/${randomUUID()}.${ext}`;
  }

  /** Load the intent, asserting it exists AND belongs to the caller's org (can't confirm another org's key). */
  private async requireIntent(principal: RequestPrincipal, storageKey: string) {
    const intent = await this.prisma.mediaUpload.findUnique({ where: { storageKey } });
    if (!intent || intent.orgId !== principal.orgId) {
      throw new NotFoundException({ error: MEDIA_ERRORS.UPLOAD_NOT_FOUND, message: 'no presigned upload for this key' });
    }
    return intent;
  }

  /** Re-check ownership at confirm time (the caller must still own the target order/item). */
  private async reauthorize(principal: RequestPrincipal, intent: { orderId: string | null; itemId: string | null }): Promise<void> {
    if (intent.orderId && intent.itemId) await this.access.requireItemForWrite(principal, intent.orderId, intent.itemId);
    else if (intent.orderId) await this.access.requireOrderForWrite(principal, intent.orderId);
  }

  /**
   * HEAD the real object and verify it matches the declared content-type + size. Any object that
   * fails verification is DELETED (immediate orphan cleanup) before the request is rejected. Missing
   * server-reported content-type or size is itself a failure — we never persist an unverified object.
   */
  private async headVerify(intent: { storageKey: string; contentType: string; byteSize: number }): Promise<{ contentType: string; sizeBytes: number }> {
    const head = await this.storage.head(intent.storageKey);
    if (!head.exists) {
      throw new NotFoundException({ error: MEDIA_ERRORS.OBJECT_NOT_FOUND, message: 'the object was never uploaded' });
    }
    const reject = async (err: Error): Promise<never> => {
      await this.storage.delete(intent.storageKey).catch(() => undefined); // best-effort cleanup of the bad object
      throw err;
    };
    if (!head.contentType || head.contentType.toLowerCase() !== intent.contentType.toLowerCase()) {
      return reject(new BadRequestException({ error: MEDIA_ERRORS.OBJECT_MISMATCH, message: `uploaded content-type ${head.contentType ?? '(none)'} != declared ${intent.contentType}` }));
    }
    if (head.size == null) {
      return reject(new BadRequestException({ error: MEDIA_ERRORS.OBJECT_MISMATCH, message: 'uploaded object size could not be determined' }));
    }
    if (head.size > this.config.maxBytes || head.size > intent.byteSize) {
      return reject(new BadRequestException({ error: MEDIA_ERRORS.TOO_LARGE, message: `uploaded size ${head.size} exceeds the declared/configured limit` }));
    }
    return { contentType: head.contentType, sizeBytes: head.size };
  }

  private async writeGeo(tx: Prisma.TransactionClient, photoId: string, lat: number, lng: number): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Photo" SET geo = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      WHERE id = ${photoId}::uuid`;
  }
}
