import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  LOGISTICS_ERRORS,
  ShiftStatus,
  VehicleStatus,
  type CreateDriverDto,
  type CreateShiftDto,
  type CreateVehicleDto,
  type ShiftActionDto,
  type UpdateVehicleDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { LogisticsAccessService } from './logistics-access.service';

@Injectable()
export class VehicleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
  ) {}

  async create(principal: RequestPrincipal, dto: CreateVehicleDto) {
    const vehicle = await this.prisma.vehicle.create({
      data: { orgId: principal.orgId, label: dto.label, capacity: dto.capacity ?? null, plate: dto.plate ?? null, status: VehicleStatus.ACTIVE, createdBy: principal.userId },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Vehicle', entityId: vehicle.id, action: 'VEHICLE_CREATED', after: { label: vehicle.label } });
    return vehicle;
  }

  list(principal: RequestPrincipal) {
    return this.access.scopedFor(principal).vehicle.findMany({ orderBy: { createdAt: 'desc' } });
  }

  get(principal: RequestPrincipal, id: string) {
    return this.access.requireVehicle(principal, id);
  }

  async update(principal: RequestPrincipal, id: string, dto: UpdateVehicleDto) {
    await this.access.requireVehicle(principal, id);
    const updated = await this.prisma.vehicle.update({
      where: { id, orgId: principal.orgId },
      data: { ...(dto.label !== undefined ? { label: dto.label } : {}), ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}), ...(dto.plate !== undefined ? { plate: dto.plate } : {}), ...(dto.status !== undefined ? { status: dto.status } : {}) },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Vehicle', entityId: id, action: 'VEHICLE_UPDATED', after: dto as Prisma.InputJsonValue });
    return updated;
  }
}

@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
  ) {}

  async create(principal: RequestPrincipal, dto: CreateDriverDto) {
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, orgId: principal.orgId } });
    if (!user) throw new BadRequestException({ error: LOGISTICS_ERRORS.DRIVER_NOT_FOUND, message: 'userId is not a user in your organization' });
    if (dto.defaultVehicleId) await this.access.requireVehicle(principal, dto.defaultVehicleId);
    try {
      const driver = await this.prisma.driver.create({
        data: { orgId: principal.orgId, userId: dto.userId, license: dto.license ?? null, defaultVehicleId: dto.defaultVehicleId ?? null, createdBy: principal.userId },
      });
      await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Driver', entityId: driver.id, action: 'DRIVER_CREATED', after: { userId: dto.userId } });
      return driver;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ error: LOGISTICS_ERRORS.DRIVER_NOT_FOUND, message: 'This user is already a driver' });
      }
      throw err;
    }
  }

  list(principal: RequestPrincipal) {
    return this.access.scopedFor(principal).driver.findMany({ orderBy: { createdAt: 'desc' } });
  }

  get(principal: RequestPrincipal, id: string) {
    return this.access.requireDriver(principal, id);
  }
}

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: LogisticsAccessService,
  ) {}

  async create(principal: RequestPrincipal, dto: CreateShiftDto) {
    await this.access.requireDriver(principal, dto.driverId);
    await this.access.requireVehicle(principal, dto.vehicleId);
    const shift = await this.prisma.shift.create({
      data: { orgId: principal.orgId, driverId: dto.driverId, vehicleId: dto.vehicleId, status: ShiftStatus.SCHEDULED, createdBy: principal.userId },
    });
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Shift', entityId: shift.id, action: 'SHIFT_CREATED', after: { driverId: dto.driverId, vehicleId: dto.vehicleId } });
    return shift;
  }

  /** SCHEDULED → ACTIVE (atomic). Location only emits during an active shift (Increment 5). */
  start(principal: RequestPrincipal, id: string, dto: ShiftActionDto) {
    return this.transition(principal, id, ShiftStatus.SCHEDULED, ShiftStatus.ACTIVE, { startedAt: new Date() }, 'SHIFT_STARTED', dto.note);
  }

  /** ACTIVE → ENDED (atomic). */
  end(principal: RequestPrincipal, id: string, dto: ShiftActionDto) {
    return this.transition(principal, id, ShiftStatus.ACTIVE, ShiftStatus.ENDED, { endedAt: new Date() }, 'SHIFT_ENDED', dto.note);
  }

  list(principal: RequestPrincipal) {
    return this.access.scopedFor(principal).shift.findMany({ orderBy: { createdAt: 'desc' } });
  }

  get(principal: RequestPrincipal, id: string) {
    return this.access.requireShift(principal, id);
  }

  private async transition(
    principal: RequestPrincipal,
    id: string,
    from: ShiftStatus,
    to: ShiftStatus,
    extra: Prisma.ShiftUpdateManyMutationInput,
    action: string,
    note?: string,
  ) {
    const shift = await this.access.requireShift(principal, id);
    if ((shift.status as unknown as ShiftStatus) !== from) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.ILLEGAL_SHIFT_TRANSITION, message: `Shift is ${shift.status}, expected ${from}` });
    }
    const res = await this.prisma.shift.updateMany({ where: { id, orgId: principal.orgId, status: from as unknown as Prisma.ShiftWhereInput['status'] }, data: { status: to as unknown as Prisma.ShiftUpdateManyMutationInput['status'], ...extra } });
    if (res.count !== 1) {
      throw new ConflictException({ error: LOGISTICS_ERRORS.ILLEGAL_SHIFT_TRANSITION, message: `Shift ${id} was concurrently modified` });
    }
    await this.audit.record({ orgId: principal.orgId, actorId: principal.userId, entity: 'Shift', entityId: id, action, before: { status: from }, after: { status: to, ...(note ? { note } : {}) } });
    return this.prisma.shift.findUniqueOrThrow({ where: { id } });
  }
}
