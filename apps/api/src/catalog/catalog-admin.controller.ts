import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createCatalogItemSchema,
  createCategorySchema,
  presignCatalogImageSchema,
  updateCatalogItemSchema,
  updateCategorySchema,
  type CreateCatalogItemDto,
  type CreateCategoryDto,
  type PresignCatalogImageDto,
  type UpdateCatalogItemDto,
  type UpdateCategoryDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { CatalogAdminService } from './catalog-admin.service';

/**
 * Dry-clean catalog admin (Increment 17) — `/v1/catalog/*` category + item management + the catalog image
 * presign. OWNER/FINANCE only (mirrors the Inc-15 `/corporate` gate); org-scoped, problem+json, audited.
 * Per-account price overrides are managed via the existing `/corporate` rate-card editor (these items are
 * `Service` rows, so they appear there automatically) — not re-implemented here.
 */
@ApiTags('catalog-admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER, RoleType.FINANCE)
@Controller('catalog')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}

  // ── categories ──

  @Get('categories')
  @ApiOperation({ summary: 'List dry-clean categories (org-scoped) with item counts.' })
  listCategories(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.listCategories(p);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a dry-clean category. Audited.' })
  createCategory(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createCategorySchema)) dto: CreateCategoryDto) {
    return this.catalog.createCategory(p, dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Rename / reorder (sortOrder) / activate-deactivate a category. Audited.' })
  updateCategory(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(updateCategorySchema)) dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(p, id, dto);
  }

  // ── catalog items ──

  @Get('admin')
  @ApiOperation({ summary: 'The admin catalog view — categories (each with items) + an uncategorized bucket; images signed.' })
  adminCatalog(@CurrentUser() p: RequestPrincipal) {
    return this.catalog.adminCatalog(p);
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a per-item dry-clean catalog item (name + base price + optional photo/category). Audited.' })
  createItem(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createCatalogItemSchema)) dto: CreateCatalogItemDto) {
    return this.catalog.createItem(p, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Edit a catalog item (name / price / category / photo / active / order). Non-ITEM service → 400. Audited.' })
  updateItem(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodBody(updateCatalogItemSchema)) dto: UpdateCatalogItemDto) {
    return this.catalog.updateItem(p, id, dto);
  }

  // ── image upload (the existing presigned media seam) ──

  @Post('image/presign')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Presign a catalog item photo upload (org-scoped). Client PUTs the bytes, then passes the storageKey when saving the item.' })
  presignImage(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(presignCatalogImageSchema)) dto: PresignCatalogImageDto) {
    return this.catalog.presignImage(p, dto);
  }
}
