import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Service, type ServiceCategory } from '@prisma/client';
import {
  CATALOG_ERRORS,
  ServiceUnit,
  ServiceVertical,
  type AdminCatalogView,
  type CatalogImagePresignResult,
  type CatalogItemView,
  type CategoriesResult,
  type CategoryView,
  type CreateCatalogItemDto,
  type CreateCategoryDto,
  type PresignCatalogImageDto,
  type UpdateCatalogItemDto,
  type UpdateCategoryDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { MediaService } from '../media/media.service';
import { MediaSigner } from '../media/storage/media-signer';
import type { RequestPrincipal } from '../auth/rbac/types';

const CURRENCY = 'CAD';

/**
 * Dry-clean visual catalog admin (Increment 17). Owner/finance manage categories + catalog items (a
 * catalog item IS a `Service` with `unit = ITEM`, so the quote engine + `PriceListItem` per-account
 * overrides work unchanged). Photos go through the EXISTING presigned media seam (MediaService) and are
 * stored as `Service.imageKey`, signed on read via the global `MediaSigner`. Org-scoped via `scopedPrisma`;
 * every mutation audited in the same transaction (the Track-A pattern). Per-account price overrides are
 * NOT re-implemented here — they are the Inc-15 rate-card editor (`/corporate` → `setRateCardItem`), which
 * already lists every service (these new items appear there automatically).
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly signer: MediaSigner,
  ) {}

  // ─────────────────────────── categories ───────────────────────────

  async listCategories(principal: RequestPrincipal): Promise<CategoriesResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.serviceCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { services: true } } },
    });
    return { categories: rows.map((c) => this.toCategoryView(c, c._count.services)) };
  }

  async createCategory(principal: RequestPrincipal, dto: CreateCategoryDto): Promise<CategoryView> {
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceCategory.create({
        data: { orgId: principal.orgId, name: dto.name, sortOrder: dto.sortOrder ?? 0, active: true, createdBy: principal.userId },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'ServiceCategory', entityId: row.id, action: 'CATALOG_CATEGORY_CREATED', after: { name: dto.name, sortOrder: dto.sortOrder ?? 0 } },
        tx,
      );
      return row;
    });
    return this.toCategoryView(created, 0);
  }

  async updateCategory(principal: RequestPrincipal, id: string, dto: UpdateCategoryDto): Promise<CategoryView> {
    const db = scopedPrisma(this.prisma, principal);
    const existing = await db.serviceCategory.findFirst({ where: { id }, include: { _count: { select: { services: true } } } });
    if (!existing) throw new NotFoundException({ error: CATALOG_ERRORS.CATEGORY_NOT_FOUND, message: `category ${id} not found in scope` });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceCategory.update({
        where: { id, orgId: principal.orgId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'ServiceCategory', entityId: id, action: 'CATALOG_CATEGORY_UPDATED', after: { ...dto } },
        tx,
      );
      return row;
    });
    return this.toCategoryView(updated, existing._count.services);
  }

  // ─────────────────────────── catalog items (Service, unit = ITEM) ───────────────────────────

  async createItem(principal: RequestPrincipal, dto: CreateCatalogItemDto): Promise<CatalogItemView> {
    const db = scopedPrisma(this.prisma, principal);
    if (dto.categoryId) await this.requireCategory(db, dto.categoryId);
    // Verify the image was really uploaded to THIS org (HEAD-verify + mark the intent CONFIRMED) before we
    // store the key — never persist an unverified/absent object.
    if (dto.imageKey) await this.media.confirmCatalogImage(principal, dto.imageKey);

    const created = await this.prisma.$transaction(async (tx) => {
      const svc = await tx.service.create({
        data: {
          orgId: principal.orgId,
          vertical: ServiceVertical.SPECIALTY,
          unit: ServiceUnit.ITEM,
          name: dto.name,
          baseRate: dto.price.toFixed(4),
          categoryId: dto.categoryId ?? null,
          imageKey: dto.imageKey ?? null,
          sortOrder: dto.sortOrder ?? 0,
          active: true,
          createdBy: principal.userId,
        },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'Service', entityId: svc.id, action: 'CATALOG_ITEM_CREATED', after: { name: dto.name, price: dto.price.toFixed(4), categoryId: dto.categoryId ?? null, hasImage: !!dto.imageKey } },
        tx,
      );
      return svc;
    });
    return this.toItemView(created);
  }

  async updateItem(principal: RequestPrincipal, id: string, dto: UpdateCatalogItemDto): Promise<CatalogItemView> {
    const db = scopedPrisma(this.prisma, principal);
    const existing = await db.service.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException({ error: CATALOG_ERRORS.ITEM_NOT_FOUND, message: `catalog item ${id} not found in scope` });
    // Catalog admin manages dry-clean ITEM services only (wash&fold LB / specialty SQFT are out of scope).
    if (existing.unit !== ServiceUnit.ITEM) {
      throw new BadRequestException({ error: CATALOG_ERRORS.NOT_A_CATALOG_ITEM, message: `service ${id} is not a per-item catalog service` });
    }
    if (dto.categoryId) await this.requireCategory(db, dto.categoryId);
    if (dto.imageKey) await this.media.confirmCatalogImage(principal, dto.imageKey);

    const updated = await this.prisma.$transaction(async (tx) => {
      const svc = await tx.service.update({
        where: { id, orgId: principal.orgId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.price !== undefined ? { baseRate: dto.price.toFixed(4) } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.imageKey !== undefined ? { imageKey: dto.imageKey } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'Service', entityId: id, action: 'CATALOG_ITEM_UPDATED', after: { ...dto } },
        tx,
      );
      return svc;
    });
    return this.toItemView(updated);
  }

  /** Presign a catalog image upload (delegates to the media seam). */
  presignImage(principal: RequestPrincipal, dto: PresignCatalogImageDto): Promise<CatalogImagePresignResult> {
    return this.media.presignCatalogImage(principal, dto);
  }

  // ─────────────────────────── admin view ───────────────────────────

  async adminCatalog(principal: RequestPrincipal): Promise<AdminCatalogView> {
    const db = scopedPrisma(this.prisma, principal);
    const [categories, items] = await Promise.all([
      db.serviceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { services: true } } } }),
      // The dry-clean catalog = every per-item (ITEM) service; grouped by category + an uncategorized bucket.
      db.service.findMany({ where: { unit: ServiceUnit.ITEM }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { category: { select: { name: true } } } }),
    ]);
    const itemViews = await Promise.all(items.map((s) => this.toItemView(s)));
    const byCategory = new Map<string, CatalogItemView[]>();
    const uncategorized: CatalogItemView[] = [];
    for (const iv of itemViews) {
      if (iv.categoryId) {
        const arr = byCategory.get(iv.categoryId) ?? [];
        arr.push(iv);
        byCategory.set(iv.categoryId, arr);
      } else {
        uncategorized.push(iv);
      }
    }
    return {
      categories: categories.map((c) => ({ ...this.toCategoryView(c, c._count.services), items: byCategory.get(c.id) ?? [] })),
      uncategorized,
      currency: CURRENCY,
    };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async requireCategory(db: ReturnType<typeof scopedPrisma>, id: string): Promise<void> {
    const cat = await db.serviceCategory.findFirst({ where: { id }, select: { id: true } });
    if (!cat) throw new NotFoundException({ error: CATALOG_ERRORS.CATEGORY_NOT_FOUND, message: `category ${id} not found in scope` });
  }

  private toCategoryView(c: Pick<ServiceCategory, 'id' | 'name' | 'sortOrder' | 'active' | 'createdAt'>, itemCount: number): CategoryView {
    return { id: c.id, name: c.name, sortOrder: c.sortOrder, active: c.active, itemCount, createdAt: c.createdAt.toISOString() };
  }

  private async toItemView(s: Service & { category?: { name: string } | null }): Promise<CatalogItemView> {
    return {
      id: s.id,
      name: s.name,
      unit: s.unit as ServiceUnit,
      baseRate: Number(s.baseRate).toFixed(4), // fixed 4dp (matches the Inc-15 rate-card format; Decimal.toString drops trailing zeros)
      categoryId: s.categoryId,
      categoryName: s.category?.name ?? null,
      imageKey: s.imageKey,
      imageUrl: s.imageKey ? await this.signer.signedGet({ storageKey: s.imageKey, url: null }) : null,
      active: s.active,
      sortOrder: s.sortOrder,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
