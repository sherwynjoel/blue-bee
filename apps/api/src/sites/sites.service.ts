import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SITE_ERRORS,
  type CreateSiteDto,
  type CustomerSite,
  type SiteDeactivateResult,
  type SiteMutationResult,
  type SiteServiceability,
  type UpdateSiteDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { ServiceZonesService, type ZonePoint } from '../service-zones/service-zones.service';
import { GEOCODER_PROVIDER, GeocodeError, type GeocoderProvider } from '../geocoding/geocoder.provider';
import type { RequestPrincipal } from '../auth/rbac/types';

/** A Site row joined with the account fields the customer view needs. */
type SiteRow = Prisma.SiteGetPayload<{ include: { account: { select: { name: true; type: true } } } }>;

/** Postgres unique-violation code, raised by the `Site_one_default_per_account` partial index. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * `ZonePoint` is an interface, so it has no implicit index signature and Prisma's `InputJsonValue` rejects
 * it. Widen to a plain literal before it goes into an audit payload.
 */
const jsonPoint = (p: ZonePoint): { lng: number; lat: number } => ({ lng: p.lng, lat: p.lat });

/**
 * Saved addresses (Increment 26) — the customer-owned WRITE side of `Site`. Closes the onboarding hole
 * where a customer with zero sites could not add one, so `BookScreen`'s picker was permanently empty.
 *
 * Three rules this service exists to enforce:
 *
 *  • **The server owns the coordinate.** Either the caller hands us a map-picked pin, or we geocode the
 *    typed address. An address that will not resolve is a 422 and writes nothing — no default point, no
 *    "close enough" city centroid. (Honesty firewall.)
 *
 *  • **The server owns the coverage claim.** Serviceability is answered by the existing PostGIS
 *    `ST_Covers` gate. When the org has drawn no active zones we report `checked: false` rather than
 *    "serviceable", because an inert gate is not evidence of coverage.
 *
 *  • **Removal is deactivation.** A past `Order`/`RouteStop` points at the site, so "remove" flips
 *    `active` and customer-facing reads filter it out. Ops/billing surfaces still resolve it, which is
 *    why a historical order keeps rendering the address it was actually picked up from.
 */
@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly serviceZones: ServiceZonesService,
    @Inject(GEOCODER_PROVIDER) private readonly geocoder: GeocoderProvider,
  ) {}

  // ─────────────────────────── create ───────────────────────────

  async create(principal: RequestPrincipal, dto: CreateSiteDto): Promise<SiteMutationResult> {
    const accountId = this.resolveAccountId(principal, dto.accountId);
    const point = await this.resolvePoint(dto.address, dto.geo);

    // Coverage is answered (and out-of-area demand captured) BEFORE the row is written, mirroring the
    // booking gate in OrdersService: if the capture write fails, the caller gets an error and there is
    // no half-state where we claimed to have "listed" an address we never recorded.
    const serviceability = await this.checkServiceability(principal, point, dto.address, { accountId });

    // The account's FIRST active address becomes its default — a customer should never have to make a
    // second trip into settings just to make their only address usable.
    const activeCount = await this.prisma.site.count({ where: { orgId: principal.orgId, accountId, active: true } });
    const isDefault = dto.isDefault === true || activeCount === 0;

    const created = await this.withDefaultRetry(() =>
      this.prisma.$transaction(async (tx) => {
        if (isDefault) await this.demoteDefaults(tx, principal.orgId, accountId);
        const site = await tx.site.create({
          data: {
            orgId: principal.orgId,
            accountId,
            name: dto.name,
            address: dto.address,
            unit: dto.unit ?? null,
            buzzer: dto.buzzer ?? null,
            notes: dto.notes ?? null,
            isDefault,
            active: true,
            createdBy: principal.userId,
          },
        });
        await this.writeGeo(tx, site.id, principal.orgId, point);
        await this.audit.record(
          {
            orgId: principal.orgId,
            actorId: principal.userId,
            entity: 'Site',
            entityId: site.id,
            action: 'SITE_CREATED',
            after: { accountId, name: dto.name, address: dto.address, geo: jsonPoint(point), isDefault, source: dto.geo ? 'map_pin' : 'geocoded' },
          },
          tx,
        );
        return site.id;
      }),
    );

    return { site: await this.readSite(principal.orgId, created), serviceability };
  }

  // ─────────────────────────── update ───────────────────────────

  async update(principal: RequestPrincipal, siteId: string, dto: UpdateSiteDto): Promise<SiteMutationResult> {
    const existing = await this.requireOwnSite(principal, siteId);
    if (!existing.active) {
      throw new ConflictException({ error: SITE_ERRORS.SITE_INACTIVE, message: `site ${siteId} is deactivated` });
    }

    // Re-resolve the point only when the address or the pin actually moved — never re-geocode a rename,
    // both to respect the upstream rate limit and to keep an already-confirmed pin exactly where it is.
    const addressChanged = dto.address !== undefined && dto.address !== existing.address;
    const point =
      dto.geo !== undefined
        ? { lng: dto.geo.lng, lat: dto.geo.lat }
        : addressChanged
          ? await this.resolvePoint(dto.address as string, undefined)
          : await this.readGeo(siteId);

    const effectiveAddress = dto.address ?? existing.address ?? '';
    const serviceability = point
      ? await this.checkServiceability(principal, point, effectiveAddress, { accountId: existing.accountId, siteId })
      : // A legacy site with no stored point: nothing to test, so claim nothing.
        { checked: false, serviceable: false, coverageRequestId: null };

    await this.withDefaultRetry(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) await this.demoteDefaults(tx, principal.orgId, existing.accountId, siteId);
        await tx.site.update({
          where: { id: siteId, orgId: principal.orgId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.address !== undefined ? { address: dto.address } : {}),
            ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
            ...(dto.buzzer !== undefined ? { buzzer: dto.buzzer } : {}),
            ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
            ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          },
        });
        if (point && (dto.geo !== undefined || addressChanged)) {
          await this.writeGeo(tx, siteId, principal.orgId, point);
        }
        await this.audit.record(
          {
            orgId: principal.orgId,
            actorId: principal.userId,
            entity: 'Site',
            entityId: siteId,
            action: 'SITE_UPDATED',
            before: { name: existing.name, address: existing.address, unit: existing.unit, buzzer: existing.buzzer, notes: existing.notes, isDefault: existing.isDefault },
            after: { ...dto, ...(point && (dto.geo !== undefined || addressChanged) ? { geo: jsonPoint(point) } : {}) },
          },
          tx,
        );
      }),
    );

    return { site: await this.readSite(principal.orgId, siteId), serviceability };
  }

  // ─────────────────────────── deactivate (soft delete) ───────────────────────────

  async deactivate(principal: RequestPrincipal, siteId: string): Promise<SiteDeactivateResult> {
    const existing = await this.requireOwnSite(principal, siteId);
    // Already deactivated ⇒ succeed unchanged. Removing a removed address is not an error, and a client
    // retrying a dropped response must not get a 409.
    if (!existing.active) {
      return { site: await this.readSite(principal.orgId, siteId), promotedDefaultSiteId: null };
    }

    const promotedDefaultSiteId = await this.prisma.$transaction(async (tx) => {
      // Clear `isDefault` alongside `active`: a removed address must not remain the account's default,
      // and the partial unique index only frees once the row stops being an active default.
      await tx.site.update({ where: { id: siteId, orgId: principal.orgId }, data: { active: false, isDefault: false } });

      // The account should never be left with addresses but no default — promote the next one so the
      // booking picker still has a pre-selection.
      let promoted: string | null = null;
      if (existing.isDefault) {
        const next = await tx.site.findFirst({
          where: { orgId: principal.orgId, accountId: existing.accountId, active: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.site.update({ where: { id: next.id, orgId: principal.orgId }, data: { isDefault: true } });
          promoted = next.id;
        }
      }
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Site',
          entityId: siteId,
          action: 'SITE_DEACTIVATED',
          before: { active: true, isDefault: existing.isDefault },
          after: { active: false, isDefault: false, promotedDefaultSiteId: promoted },
        },
        tx,
      );
      return promoted;
    });

    return { site: await this.readSite(principal.orgId, siteId), promotedDefaultSiteId };
  }

  // ─────────────────────────── helpers ───────────────────────────

  /**
   * Which account owns the new address. A customer principal is confined to `accountIds` (from their
   * ACCOUNT-scoped role grants), so the account is inferred when there is exactly one and must be stated
   * when there are several. An explicit `accountId` outside that set is a 403 — never a silent write to
   * whichever account happened to be first.
   */
  private resolveAccountId(principal: RequestPrincipal, requested?: string): string {
    if (requested !== undefined) {
      if (!principal.accountIds.includes(requested)) {
        throw new ForbiddenException({ error: SITE_ERRORS.ACCOUNT_FORBIDDEN, message: `account ${requested} is outside your scope` });
      }
      return requested;
    }
    if (principal.accountIds.length === 0) {
      throw new ForbiddenException({ error: SITE_ERRORS.NO_ACCOUNT, message: 'this principal is not scoped to a customer account' });
    }
    if (principal.accountIds.length > 1) {
      throw new BadRequestException({ error: SITE_ERRORS.ACCOUNT_AMBIGUOUS, message: 'accountId is required: this login spans multiple accounts' });
    }
    return principal.accountIds[0] as string;
  }

  /**
   * The point for an address: a caller-supplied pin wins (the customer dragged it onto their door),
   * otherwise the server geocodes. Geocoder failures are translated, never swallowed — `not_found` is a
   * permanent 422 (the address does not exist upstream), `unavailable` a transient 503.
   */
  private async resolvePoint(address: string, geo: ZonePoint | undefined): Promise<ZonePoint> {
    if (geo) return { lng: geo.lng, lat: geo.lat };
    try {
      const { lng, lat } = await this.geocoder.geocode(address);
      return { lng, lat };
    } catch (err) {
      if (err instanceof GeocodeError && err.reason === 'not_found') {
        throw new UnprocessableEntityException({
          error: SITE_ERRORS.GEOCODE_FAILED,
          message: 'We could not find that address. Check it, or drop a pin on the map.',
        });
      }
      throw new ServiceUnavailableException({
        error: SITE_ERRORS.GEOCODE_UNAVAILABLE,
        message: 'Address lookup is temporarily unavailable. Please try again.',
      });
    }
  }

  /**
   * The org's coverage answer for a point. `hasActiveZones === false` means the owner has drawn no zones
   * yet, so the gate is inert: report `checked: false` and let the app stay silent rather than promise
   * service we have not defined. Out-of-area captures the demand exactly as a blocked booking does.
   */
  private async checkServiceability(
    principal: RequestPrincipal,
    point: ZonePoint,
    address: string,
    context: Record<string, unknown>,
  ): Promise<SiteServiceability> {
    const { hasActiveZones, covered } = await this.serviceZones.isServiceable(principal.orgId, point);
    if (!hasActiveZones) return { checked: false, serviceable: false, coverageRequestId: null };
    if (covered) return { checked: true, serviceable: true, coverageRequestId: null };

    const coverageRequestId = await this.serviceZones.captureCoverageRequest({
      orgId: principal.orgId,
      userId: principal.userId,
      point,
      address: address.length > 0 ? address : null,
      context: { source: 'saved_address', ...context },
    });
    return { checked: true, serviceable: false, coverageRequestId };
  }

  /**
   * Load a site the caller is allowed to touch. Row-scoping does the work: a cross-account (or cross-org)
   * id simply is not in scope and resolves to null ⇒ 404, matching the codebase convention that an
   * out-of-scope id is indistinguishable from a nonexistent one. (403 is reserved for the ROLE gate, so
   * a probe cannot use the status code to prove another customer's address exists.)
   */
  private async requireOwnSite(principal: RequestPrincipal, siteId: string): Promise<SiteRow> {
    const site = await scopedPrisma(this.prisma, principal).site.findFirst({
      where: { id: siteId },
      include: { account: { select: { name: true, type: true } } },
    });
    if (!site) throw new NotFoundException({ error: SITE_ERRORS.SITE_NOT_FOUND, message: `site ${siteId} not found` });
    return site;
  }

  /**
   * Read a site back by id, pinned to the org. Deliberately NOT the scoped client: a SITE-scoped
   * principal's `siteIds` come from a JWT minted before this row existed, so a scoped read of a
   * just-created site returns null (see scoped-prisma.ts SITE_DIRECT). Ownership was already established
   * by `resolveAccountId`/`requireOwnSite`, and `orgId` keeps the tenant boundary intact.
   */
  private async readSite(orgId: string, siteId: string): Promise<CustomerSite> {
    const site = await this.prisma.site.findFirstOrThrow({
      where: { id: siteId, orgId },
      include: { account: { select: { name: true, type: true } } },
    });
    const geo = await this.readGeo(siteId);
    return this.toCustomerSite(site, geo);
  }

  private toCustomerSite(s: SiteRow, geo: ZonePoint | null): CustomerSite {
    return {
      id: s.id,
      accountId: s.accountId,
      name: s.name,
      address: s.address,
      accountName: s.account.name,
      accountType: s.account.type as unknown as CustomerSite['accountType'],
      geo,
      unit: s.unit,
      buzzer: s.buzzer,
      notes: s.notes,
      isDefault: s.isDefault,
    };
  }

  /** `Site.geo` is a Prisma `Unsupported` geography column — write it with the as-built ST_MakePoint SQL. */
  private async writeGeo(tx: Prisma.TransactionClient, siteId: string, orgId: string, point: ZonePoint): Promise<void> {
    await tx.$executeRaw`
      UPDATE "Site" SET geo = ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography
      WHERE id = ${siteId}::uuid AND org_id = ${orgId}::uuid`;
  }

  /** Read one site's {lng,lat} back out of PostGIS (geometry cast → ST_X/ST_Y). Null when never set. */
  private async readGeo(siteId: string): Promise<ZonePoint | null> {
    const rows = await this.prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>(Prisma.sql`
      SELECT ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng
      FROM "Site" WHERE id = ${siteId}::uuid AND geo IS NOT NULL`);
    const row = rows[0];
    if (!row || row.lat === null || row.lng === null) return null;
    return { lng: Number(row.lng), lat: Number(row.lat) };
  }

  /** Clear the account's current active default so a new one can take the partial unique index. */
  private async demoteDefaults(tx: Prisma.TransactionClient, orgId: string, accountId: string, exceptSiteId?: string): Promise<void> {
    await tx.site.updateMany({
      where: { orgId, accountId, isDefault: true, active: true, ...(exceptSiteId ? { NOT: { id: exceptSiteId } } : {}) },
      data: { isDefault: false },
    });
  }

  /**
   * `Site_one_default_per_account` is a real database invariant, so two concurrent "make this my default"
   * writes race: under READ COMMITTED neither transaction sees the other's uncommitted insert, and the
   * loser fails the index on commit. That is exactly the outcome we want (no two defaults), but it is a
   * lost write, not a user error — so replay it once against the now-committed state.
   */
  private async withDefaultRetry<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const isDefaultCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === UNIQUE_VIOLATION &&
        String((err.meta as { target?: unknown } | undefined)?.target ?? '').includes('one_default_per_account');
      if (!isDefaultCollision) throw err;
      return work();
    }
  }
}
