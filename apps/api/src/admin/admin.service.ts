import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type DevicePlatform,
  RoleScope,
  RoleType,
  type AdminDevice,
  type AdminDevicesResult,
  type AdminDriversResult,
  type AdminUserRolesResult,
  type AdminUsersResult,
  type AssignDriverVehicleDto,
  type AssignRoleDto,
  type AuditLogEntry,
  type AuditLogResult,
  type CreateDeviceDto,
  type NotificationConfigView,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { AuditService } from '../orders/audit.service';
import { loadNotificationsConfig } from '../config/notifications.config';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AdminInputError, clampLimit, maskPushToken, normalizeGrantScope, parseOptionalDate } from './admin-policy';

const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

/**
 * Admin reads + mutations (Increment 16, PRD Epic B6.2 / §17.3) — OWNER-gated, org-scoped via
 * `scopedPrisma`, and **every mutation writes an immutable AuditLog** (§8.7 staff accountability).
 * Thin module (mirrors Inc-15 analytics / Inc-14a owner). Vehicle/Driver CRUD already ships (Inc-4
 * logistics, audited) and is reused — this adds role assignment, device management, driver→vehicle
 * assignment, a read-only notification-config viewer, and a read-only audit-log viewer.
 *
 * tx-scoping (carry-forward lesson): the scoped client's extension does NOT reach inside a
 * `$transaction`, so every write inside a tx pins `org_id` explicitly, AFTER a scoped read has proven
 * the target row is in the principal's org (a cross-org id resolves to null → 404).
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ───────────────────────────── users & roles ─────────────────────────────

  async listUsers(principal: RequestPrincipal): Promise<AdminUsersResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        roles: { select: { id: true, role: true, scope: true, scopeId: true }, orderBy: { role: 'asc' } },
      },
    });
    // Prisma generates its own nominal enums (values identical to the shared enums) — map across.
    const users = rows.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      status: u.status as string,
      roles: u.roles.map((g) => ({
        id: g.id,
        role: g.role as unknown as RoleType,
        scope: g.scope as unknown as RoleScope,
        scopeId: g.scopeId ?? null,
      })),
    }));
    return { users, count: users.length };
  }

  /** The target user's grants after a change — what assign/revoke return (reflected). */
  private async userRoles(principal: RequestPrincipal, userId: string): Promise<AdminUserRolesResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.userRole.findMany({
      where: { userId },
      select: { id: true, role: true, scope: true, scopeId: true },
      orderBy: { role: 'asc' },
    });
    const roles = rows.map((g) => ({
      id: g.id,
      role: g.role as unknown as RoleType,
      scope: g.scope as unknown as RoleScope,
      scopeId: g.scopeId ?? null,
    }));
    return { userId, roles };
  }

  async assignRole(principal: RequestPrincipal, userId: string, dto: AssignRoleDto): Promise<AdminUserRolesResult> {
    const db = scopedPrisma(this.prisma, principal);
    let scopeId: string | null;
    try {
      scopeId = normalizeGrantScope(dto.scope, dto.scopeId ?? null);
    } catch (err) {
      if (err instanceof AdminInputError) throw new BadRequestException(err.message);
      throw err;
    }

    // Target user must be in the principal's org (scoped read → null for a cross-org id).
    const user = await db.user.findFirst({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException(`user ${userId} not found in scope`);

    // An ACCOUNT/SITE grant's scopeId must reference a row IN this org (no cross-org escalation).
    if (dto.scope === RoleScope.ACCOUNT) {
      const acc = await db.account.findFirst({ where: { id: scopeId! }, select: { id: true } });
      if (!acc) throw new BadRequestException(`scopeId ${scopeId} is not an account in this org`);
    } else if (dto.scope === RoleScope.SITE) {
      const site = await db.site.findFirst({ where: { id: scopeId! }, select: { id: true } });
      if (!site) throw new BadRequestException(`scopeId ${scopeId} is not a site in this org`);
    }

    await this.prisma.$transaction(async (tx) => {
      // tx is UNSCOPED → pin org_id explicitly in the filter and the write.
      const existing = await tx.userRole.findFirst({
        where: { orgId: principal.orgId, userId, role: dto.role, scope: dto.scope, scopeId },
        select: { id: true },
      });
      if (existing) throw new ConflictException('user already holds this role grant');
      const grant = await tx.userRole.create({
        data: { orgId: principal.orgId, userId, role: dto.role, scope: dto.scope, scopeId, createdBy: principal.userId },
        select: { id: true },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'UserRole',
          entityId: grant.id,
          action: 'ROLE_ASSIGNED',
          after: { userId, role: dto.role, scope: dto.scope, scopeId },
        },
        tx,
      );
    });

    return this.userRoles(principal, userId);
  }

  async revokeRole(principal: RequestPrincipal, userId: string, roleId: string): Promise<AdminUserRolesResult> {
    const db = scopedPrisma(this.prisma, principal);
    // Scoped read proves both org ownership AND that the grant belongs to this user.
    const grant = await db.userRole.findFirst({
      where: { id: roleId, userId },
      select: { id: true, role: true, scope: true, scopeId: true },
    });
    if (!grant) throw new NotFoundException(`role grant ${roleId} not found for user ${userId}`);

    await this.prisma.$transaction(async (tx) => {
      // tx is UNSCOPED → pin org_id explicitly. Re-count owners INSIDE the tx (narrows the lockout
      // window vs a read-then-write outside it; a fully-concurrent dual revoke under READ COMMITTED is
      // an accepted residual for an OWNER-only, low-concurrency admin action).
      if (grant.role === RoleType.OWNER) {
        const owners = await tx.userRole.count({ where: { orgId: principal.orgId, role: RoleType.OWNER } });
        if (owners <= 1) throw new ConflictException('cannot revoke the last OWNER in the org');
      }
      const res = await tx.userRole.deleteMany({ where: { id: roleId, orgId: principal.orgId } });
      if (res.count === 0) throw new NotFoundException(`role grant ${roleId} not found in scope`);
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'UserRole',
          entityId: roleId,
          action: 'ROLE_REVOKED',
          before: { userId, role: grant.role, scope: grant.scope, scopeId: grant.scopeId },
        },
        tx,
      );
    });

    return this.userRoles(principal, userId);
  }

  // ───────────────────────────── devices ─────────────────────────────

  async listDevices(principal: RequestPrincipal): Promise<AdminDevicesResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.device.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        platform: true,
        pushToken: true,
        lastSeen: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });
    const devices: AdminDevice[] = rows.map((d) => ({
      id: d.id,
      userId: d.userId,
      userName: d.user?.name ?? null,
      platform: d.platform as unknown as DevicePlatform,
      pushTokenMasked: maskPushToken(d.pushToken),
      lastSeen: d.lastSeen ? d.lastSeen.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    }));
    return { devices, count: devices.length };
  }

  async createDevice(principal: RequestPrincipal, dto: CreateDeviceDto): Promise<AdminDevice> {
    const db = scopedPrisma(this.prisma, principal);
    const user = await db.user.findFirst({ where: { id: dto.userId }, select: { id: true, name: true } });
    if (!user) throw new NotFoundException(`user ${dto.userId} not found in scope`);

    const device = await this.prisma.$transaction(async (tx) => {
      const created = await tx.device.create({
        data: {
          orgId: principal.orgId,
          userId: dto.userId,
          platform: dto.platform,
          pushToken: dto.pushToken ?? null,
          createdBy: principal.userId,
        },
        select: { id: true, userId: true, platform: true, pushToken: true, lastSeen: true, createdAt: true },
      });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Device',
          entityId: created.id,
          action: 'DEVICE_CREATED',
          after: { userId: dto.userId, platform: dto.platform },
        },
        tx,
      );
      return created;
    });

    return {
      id: device.id,
      userId: device.userId,
      userName: user.name,
      platform: device.platform as unknown as DevicePlatform,
      pushTokenMasked: maskPushToken(device.pushToken),
      lastSeen: device.lastSeen ? device.lastSeen.toISOString() : null,
      createdAt: device.createdAt.toISOString(),
    };
  }

  async deleteDevice(principal: RequestPrincipal, id: string): Promise<void> {
    const db = scopedPrisma(this.prisma, principal);
    const device = await db.device.findFirst({ where: { id }, select: { id: true, userId: true } });
    if (!device) throw new NotFoundException(`device ${id} not found in scope`);

    await this.prisma.$transaction(async (tx) => {
      // tx is UNSCOPED → pin org_id on the delete (defence-in-depth on top of the scoped read above).
      await tx.device.deleteMany({ where: { id, orgId: principal.orgId } });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Device',
          entityId: id,
          action: 'DEVICE_DELETED',
          before: { userId: device.userId },
        },
        tx,
      );
    });
  }

  // ───────────────────────────── drivers (vehicle assignment) ─────────────────────────────

  async listDrivers(principal: RequestPrincipal): Promise<AdminDriversResult> {
    const db = scopedPrisma(this.prisma, principal);
    const rows = await db.driver.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, license: true, defaultVehicleId: true, user: { select: { name: true } } },
    });
    const drivers = rows.map((d) => ({
      id: d.id,
      userId: d.userId,
      name: d.user?.name ?? null,
      license: d.license,
      defaultVehicleId: d.defaultVehicleId,
    }));
    return { drivers, count: drivers.length };
  }

  async assignDriverVehicle(
    principal: RequestPrincipal,
    driverId: string,
    dto: AssignDriverVehicleDto,
  ): Promise<AdminDriversResult['drivers'][number]> {
    const db = scopedPrisma(this.prisma, principal);
    const driver = await db.driver.findFirst({
      where: { id: driverId },
      select: { id: true, userId: true, license: true, defaultVehicleId: true, user: { select: { name: true } } },
    });
    if (!driver) throw new NotFoundException(`driver ${driverId} not found in scope`);

    if (dto.defaultVehicleId !== null) {
      const vehicle = await db.vehicle.findFirst({ where: { id: dto.defaultVehicleId }, select: { id: true } });
      if (!vehicle) throw new BadRequestException(`vehicle ${dto.defaultVehicleId} is not in this org`);
    }

    await this.prisma.$transaction(async (tx) => {
      // tx is UNSCOPED → pin org_id on the update (defence-in-depth on top of the scoped read above).
      await tx.driver.updateMany({ where: { id: driverId, orgId: principal.orgId }, data: { defaultVehicleId: dto.defaultVehicleId } });
      await this.audit.record(
        {
          orgId: principal.orgId,
          actorId: principal.userId,
          entity: 'Driver',
          entityId: driverId,
          action: 'DRIVER_VEHICLE_ASSIGNED',
          before: { defaultVehicleId: driver.defaultVehicleId },
          after: { defaultVehicleId: dto.defaultVehicleId },
        },
        tx,
      );
    });

    return {
      id: driver.id,
      userId: driver.userId,
      name: driver.user?.name ?? null,
      license: driver.license,
      defaultVehicleId: dto.defaultVehicleId,
    };
  }

  // ───────────────────────────── notification config (read-only) ─────────────────────────────

  notificationConfig(): NotificationConfigView {
    const cfg = loadNotificationsConfig();
    const events = Object.entries(cfg.matrix).map(([event, channels]) => ({
      event,
      channels: channels as unknown as string[],
      urgent: cfg.urgentEventTypes.has(event),
    }));
    return {
      appName: cfg.appName,
      events,
      quietHours: { policy: cfg.quietHours.policy, defaultTimezone: cfg.quietHours.defaultTimezone },
      templatesEditable: false,
      note: 'Notification templates are static, EN-only code-config (Inc-8). This is a read-only viewer of the live event→channel matrix; an editable per-org template store is a later-phase add. Per-user channel opt-outs + quiet hours live in NotificationPreference (user settings).',
    };
  }

  // ───────────────────────────── audit-log viewer (read-only, paginated) ─────────────────────────────

  async auditLogs(
    principal: RequestPrincipal,
    query: { entity?: string; entityId?: string; actorId?: string; action?: string; from?: string; to?: string; cursor?: string; limit?: string },
  ): Promise<AuditLogResult> {
    const db = scopedPrisma(this.prisma, principal);
    const limit = clampLimit(query.limit, AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT);

    let from: Date | undefined;
    let to: Date | undefined;
    try {
      from = parseOptionalDate(query.from, 'from');
      to = parseOptionalDate(query.to, 'to');
    } catch (err) {
      if (err instanceof AdminInputError) throw new BadRequestException(err.message);
      throw err;
    }

    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (from || to) where.at = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };

    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: limit + 1, // fetch one extra to detect a next page
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        entity: true,
        entityId: true,
        action: true,
        actorId: true,
        at: true,
        before: true,
        after: true,
        actor: { select: { name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const entries: AuditLogEntry[] = page.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      actorId: r.actorId,
      actorName: r.actor?.name ?? null,
      at: r.at.toISOString(),
      before: r.before ?? null,
      after: r.after ?? null,
    }));
    return { entries, nextCursor: hasMore ? page[page.length - 1].id : null };
  }
}
