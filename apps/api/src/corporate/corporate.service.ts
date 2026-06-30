import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AccountType,
  BillingMode,
  CORPORATE_ERRORS,
  type CorporateAccountView,
  type CorporateAccountsResult,
  type CorporateBuildingView,
  type CorporateBuildingsResult,
  type CreateBuildingDto,
  type CreateCorporateAccountDto,
  type GenerateJoinCodeDto,
  type JoinCodeView,
  type MembershipsResult,
  type RateCardItemView,
  type RateCardView,
  type RedeemJoinCodeDto,
  type RedeemResultView,
  type ServiceUnit,
  type SetRateCardItemDto,
  type UpdateBuildingDto,
  type UpdateCorporateAccountDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma, type ScopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { PricingService } from '../orders/pricing.service';
import type { RequestPrincipal } from '../auth/rbac/types';

const CURRENCY = 'CAD';
/** Crockford-ish alphabet (no I/O/0/1) — readable join codes a member can type from a flyer. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

/**
 * Corporate accounts + per-account rate cards + buildings + join codes (Increment 15). Owner/finance
 * manage the account, its buildings (Site geo + match radius), and its rate card (the account-bound
 * PriceList / PriceListItem). Members redeem a join code for a pricing-only CorporateMembership. All
 * reads org-scoped via `scopedPrisma`; every mutation audited in the same transaction (the Track-A
 * pattern, explicit org_id inside the tx). The pricing ENGINE that consumes this lives in
 * `orders/pricing-account.service` + `PricingService.resolveRate` — this module owns the data around it.
 */
@Injectable()
export class CorporateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pricing: PricingService,
  ) {}

  // ─────────────────────────── corporate accounts ───────────────────────────

  async createAccount(principal: RequestPrincipal, dto: CreateCorporateAccountDto): Promise<CorporateAccountView> {
    const created = await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          orgId: principal.orgId,
          type: AccountType.BUSINESS,
          name: dto.name,
          billingMode: BillingMode.PER_ORDER,
          corporate: true,
          createdBy: principal.userId,
        },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Account',
          entityId: account.id,
          action: 'CORPORATE_ACCOUNT_CREATED',
          after: { name: dto.name, type: AccountType.BUSINESS, billingMode: BillingMode.PER_ORDER, corporate: true },
        },
        tx,
      );
      return account;
    });
    return this.toAccountView(created, 0, 0);
  }

  async listAccounts(principal: RequestPrincipal): Promise<CorporateAccountsResult> {
    const db = scopedPrisma(this.prisma, principal);
    const accounts = await db.account.findMany({
      where: { corporate: true },
      orderBy: { name: 'asc' },
      include: { _count: { select: { sites: true, memberships: true } } },
    });
    return {
      accounts: accounts.map((a) => this.toAccountView(a, a._count.sites, a._count.memberships)),
    };
  }

  async getAccount(principal: RequestPrincipal, accountId: string): Promise<CorporateAccountView> {
    const db = scopedPrisma(this.prisma, principal);
    const account = await this.requireCorporateAccount(db, accountId);
    const counts = await db.account.findFirstOrThrow({
      where: { id: accountId },
      include: { _count: { select: { sites: true, memberships: true } } },
    });
    return this.toAccountView(account, counts._count.sites, counts._count.memberships);
  }

  async updateAccount(principal: RequestPrincipal, accountId: string, dto: UpdateCorporateAccountDto): Promise<CorporateAccountView> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.update({
        where: { id: accountId, orgId: principal.orgId },
        data: { ...(dto.name !== undefined ? { name: dto.name } : {}) },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'Account', entityId: accountId, action: 'CORPORATE_ACCOUNT_UPDATED', after: { ...dto } },
        tx,
      );
      return account;
    });
    const counts = await db.account.findFirstOrThrow({ where: { id: accountId }, include: { _count: { select: { sites: true, memberships: true } } } });
    return this.toAccountView(updated, counts._count.sites, counts._count.memberships);
  }

  // ─────────────────────────── buildings (Site + match boundary) ───────────────────────────

  async listBuildings(principal: RequestPrincipal, accountId: string): Promise<CorporateBuildingsResult> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);
    const sites = await db.site.findMany({ where: { accountId }, orderBy: { name: 'asc' } });
    const geo = await this.readSiteGeo(sites.map((s) => s.id));
    return { buildings: sites.map((s) => this.toBuildingView(s, geo.get(s.id) ?? null)) };
  }

  async createBuilding(principal: RequestPrincipal, accountId: string, dto: CreateBuildingDto): Promise<CorporateBuildingView> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);

    const site = await this.prisma.$transaction(async (tx) => {
      const created = await tx.site.create({
        data: {
          orgId: principal.orgId,
          accountId,
          name: dto.name,
          address: dto.address ?? null,
          matchRadiusM: dto.matchRadiusM,
          createdBy: principal.userId,
        },
      });
      // geography(Point,4326) is Prisma `Unsupported` → set via raw SQL (the as-built ST_MakePoint pattern).
      await tx.$executeRaw`
        UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${dto.geo.lng}, ${dto.geo.lat}), 4326)::geography
        WHERE id = ${created.id}::uuid AND org_id = ${principal.orgId}::uuid`;
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Site',
          entityId: created.id,
          action: 'CORPORATE_BUILDING_CREATED',
          after: { accountId, name: dto.name, address: dto.address ?? null, geo: dto.geo, matchRadiusM: dto.matchRadiusM },
        },
        tx,
      );
      return created;
    });
    const geo = await this.readSiteGeo([site.id]);
    return this.toBuildingView(site, geo.get(site.id) ?? null);
  }

  async updateBuilding(principal: RequestPrincipal, siteId: string, dto: UpdateBuildingDto): Promise<CorporateBuildingView> {
    const db = scopedPrisma(this.prisma, principal);
    const existing = await db.site.findFirst({ where: { id: siteId } });
    if (!existing) throw new NotFoundException({ error: CORPORATE_ERRORS.BUILDING_NOT_FOUND, message: `building ${siteId} not found in scope` });
    // Only corporate-account buildings are managed here (a residential/care-home site is out of scope).
    await this.requireCorporateAccount(db, existing.accountId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const site = await tx.site.update({
        where: { id: siteId, orgId: principal.orgId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.matchRadiusM !== undefined ? { matchRadiusM: dto.matchRadiusM } : {}),
        },
      });
      if (dto.geo !== undefined) {
        await tx.$executeRaw`
          UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${dto.geo.lng}, ${dto.geo.lat}), 4326)::geography
          WHERE id = ${siteId}::uuid AND org_id = ${principal.orgId}::uuid`;
      }
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'Site', entityId: siteId, action: 'CORPORATE_BUILDING_UPDATED', after: { ...dto } },
        tx,
      );
      return site;
    });
    const geo = await this.readSiteGeo([siteId]);
    return this.toBuildingView(updated, geo.get(siteId) ?? null);
  }

  // ─────────────────────────── rate card (PriceList / PriceListItem) ───────────────────────────

  async getRateCard(principal: RequestPrincipal, accountId: string): Promise<RateCardView> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);

    const [services, accountList, defaultList] = await Promise.all([
      db.service.findMany({ where: {}, orderBy: [{ vertical: 'asc' }, { name: 'asc' }] }),
      db.priceList.findFirst({ where: { accountId, active: true }, include: { items: true } }),
      db.priceList.findFirst({ where: { accountId: null, active: true }, include: { items: true } }),
    ]);
    const accountItemByService = new Map((accountList?.items ?? []).map((i) => [i.serviceId, i]));
    const defaultItemByService = new Map((defaultList?.items ?? []).map((i) => [i.serviceId, i]));

    const items: RateCardItemView[] = [];
    for (const s of services) {
      // Reuse the single source of truth for the effective rate (account_override → account → default → base).
      const resolved = await this.pricing.resolveRate(principal.orgId, accountId, s.id);
      const ai = accountItemByService.get(s.id);
      const accountRate = ai ? (ai.accountOverride ?? ai.rate) : null;
      const di = defaultItemByService.get(s.id);
      items.push({
        serviceId: s.id,
        serviceName: s.name,
        unit: s.unit as ServiceUnit,
        accountRate: accountRate !== null && accountRate !== undefined ? this.fmt(accountRate) : null,
        defaultRate: di ? this.fmt(di.rate) : null,
        baseRate: this.fmt(s.baseRate),
        effectiveRate: resolved.rate.toFixed(4),
        source: resolved.source,
      });
    }
    return { accountId, priceListId: accountList?.id ?? null, currency: CURRENCY, items };
  }

  async setRateCardItem(principal: RequestPrincipal, accountId: string, serviceId: string, dto: SetRateCardItemDto): Promise<RateCardItemView> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);
    const service = await db.service.findFirst({ where: { id: serviceId } });
    if (!service) throw new NotFoundException({ error: CORPORATE_ERRORS.SERVICE_NOT_FOUND, message: `service ${serviceId} not found in scope` });

    const rate = dto.rate.toFixed(4);
    await this.prisma.$transaction(async (tx) => {
      // Lazily create the account's rate card (a PriceList bound to the account), then upsert the item.
      let priceList = await tx.priceList.findFirst({ where: { orgId: principal.orgId, accountId, active: true } });
      if (!priceList) {
        priceList = await tx.priceList.create({
          data: { orgId: principal.orgId, name: 'Corporate rate card', accountId, active: true, createdBy: principal.userId },
        });
      }
      await tx.priceListItem.upsert({
        where: { priceListId_serviceId: { priceListId: priceList.id, serviceId } },
        create: { orgId: principal.orgId, priceListId: priceList.id, serviceId, rate, createdBy: principal.userId },
        update: { rate },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'PriceList', entityId: priceList.id, action: 'RATE_CARD_ITEM_SET', after: { accountId, serviceId, rate } },
        tx,
      );
    });

    // Reflect the resolved rate after the write (the editor shows the truth, not the request echo).
    const resolved = await this.pricing.resolveRate(principal.orgId, accountId, serviceId);
    const defaultList = await db.priceList.findFirst({ where: { accountId: null, active: true }, include: { items: { where: { serviceId } } } });
    const di = defaultList?.items[0];
    return {
      serviceId,
      serviceName: service.name,
      unit: service.unit as ServiceUnit,
      accountRate: rate,
      defaultRate: di ? this.fmt(di.rate) : null,
      baseRate: this.fmt(service.baseRate),
      effectiveRate: resolved.rate.toFixed(4),
      source: resolved.source,
    };
  }

  // ─────────────────────────── join code ───────────────────────────

  async generateJoinCode(principal: RequestPrincipal, accountId: string, dto: GenerateJoinCodeDto): Promise<JoinCodeView> {
    const db = scopedPrisma(this.prisma, principal);
    await this.requireCorporateAccount(db, accountId);
    const expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000) : null;

    const account = await this.prisma.$transaction(async (tx) => {
      // Retry on the (astronomically rare) unique collision.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = this.randomCode();
        try {
          const updated = await tx.account.update({
            where: { id: accountId, orgId: principal.orgId },
            data: { joinCode: code, joinCodeExpiresAt: expiresAt },
          });
          await this.audit.record(
            { orgId: principal.orgId, actorId: principal.userId, entity: 'Account', entityId: accountId, action: 'CORPORATE_JOIN_CODE_GENERATED', after: { joinCodeExpiresAt: expiresAt?.toISOString() ?? null } },
            tx,
          );
          return updated;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
          throw err;
        }
      }
      throw new ConflictException({ error: CORPORATE_ERRORS.ACCOUNT_NOT_FOUND, message: 'could not allocate a unique join code; retry' });
    });
    return { accountId, joinCode: account.joinCode!, joinCodeExpiresAt: account.joinCodeExpiresAt?.toISOString() ?? null };
  }

  /** Redeem a join code → a pricing-only membership for the calling user. Idempotent; org-scoped. */
  async redeem(principal: RequestPrincipal, dto: RedeemJoinCodeDto): Promise<RedeemResultView> {
    const code = dto.code.trim().toUpperCase();
    // Org-scoped lookup: a code from another org (or a non-corporate account) is simply "invalid" — never
    // leaks cross-tenant existence. The unique constraint is global; orgId pins it to the caller's tenant.
    const account = await this.prisma.account.findFirst({ where: { joinCode: code, orgId: principal.orgId, corporate: true } });
    if (!account) throw new BadRequestException({ error: CORPORATE_ERRORS.INVALID_JOIN_CODE, message: 'that join code is not valid' });
    if (account.joinCodeExpiresAt && account.joinCodeExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException({ error: CORPORATE_ERRORS.JOIN_CODE_EXPIRED, message: 'that join code has expired' });
    }

    const existing = await this.prisma.corporateMembership.findUnique({ where: { userId_accountId: { userId: principal.userId, accountId: account.id } } });
    if (existing && existing.status === 'ACTIVE') {
      return { accountId: account.id, accountName: account.name, status: 'ACTIVE', source: 'JOIN_CODE', alreadyMember: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.corporateMembership.upsert({
        where: { userId_accountId: { userId: principal.userId, accountId: account.id } },
        create: { orgId: principal.orgId, userId: principal.userId, accountId: account.id, source: 'JOIN_CODE', status: 'ACTIVE', joinCodeUsed: code, createdBy: principal.userId },
        update: { status: 'ACTIVE', joinCodeUsed: code },
      });
      await this.audit.record(
        { orgId: principal.orgId, actorId: principal.userId, entity: 'CorporateMembership', entityId: account.id, action: 'CORPORATE_MEMBERSHIP_REDEEMED', after: { accountId: account.id, userId: principal.userId, source: 'JOIN_CODE' } },
        tx,
      );
    });
    return { accountId: account.id, accountName: account.name, status: 'ACTIVE', source: 'JOIN_CODE', alreadyMember: false };
  }

  /** The calling user's own memberships (userId-scoped — the user-owned read pattern). */
  async listMyMemberships(principal: RequestPrincipal): Promise<MembershipsResult> {
    const rows = await this.prisma.corporateMembership.findMany({
      where: { userId: principal.userId, orgId: principal.orgId },
      orderBy: { createdAt: 'desc' },
      include: { account: { select: { name: true } } },
    });
    return {
      memberships: rows.map((m) => ({
        id: m.id,
        accountId: m.accountId,
        accountName: m.account.name,
        status: m.status,
        source: m.source,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  // ─────────────────────────── helpers ───────────────────────────

  private async requireCorporateAccount(db: ScopedPrisma, accountId: string) {
    const account = await db.account.findFirst({ where: { id: accountId } });
    if (!account) throw new NotFoundException({ error: CORPORATE_ERRORS.ACCOUNT_NOT_FOUND, message: `account ${accountId} not found in scope` });
    if (!account.corporate) throw new BadRequestException({ error: CORPORATE_ERRORS.NOT_CORPORATE, message: `account ${accountId} is not a corporate account` });
    return account;
  }

  /** Read lat/lng for a set of sites from the PostGIS geography column (geometry cast → ST_X/ST_Y). */
  private async readSiteGeo(siteIds: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    const out = new Map<string, { lat: number; lng: number }>();
    if (siteIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; lat: number | null; lng: number | null }>>(Prisma.sql`
      SELECT id, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
      FROM "Site" WHERE id IN (${Prisma.join(siteIds.map((id) => Prisma.sql`${id}::uuid`))})`);
    for (const r of rows) {
      if (r.lat !== null && r.lng !== null) out.set(r.id, { lat: Number(r.lat), lng: Number(r.lng) });
    }
    return out;
  }

  private randomCode(): string {
    let s = '';
    for (let i = 0; i < CODE_LEN; i += 1) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    return s;
  }

  private fmt(v: Prisma.Decimal | string | number): string {
    return Number(v).toFixed(4);
  }

  private toAccountView(a: { id: string; name: string; type: string; billingMode: string; corporate: boolean; joinCode: string | null; joinCodeExpiresAt: Date | null; createdAt: Date }, buildingCount: number, memberCount: number): CorporateAccountView {
    return {
      id: a.id,
      name: a.name,
      type: a.type as AccountType,
      billingMode: a.billingMode as BillingMode,
      corporate: a.corporate,
      joinCode: a.joinCode,
      joinCodeExpiresAt: a.joinCodeExpiresAt?.toISOString() ?? null,
      buildingCount,
      memberCount,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private toBuildingView(s: { id: string; accountId: string; name: string; address: string | null; matchRadiusM: number | null; createdAt: Date }, geo: { lat: number; lng: number } | null): CorporateBuildingView {
    return {
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      address: s.address,
      geo,
      matchRadiusM: s.matchRadiusM,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
