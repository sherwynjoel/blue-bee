import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  createDriverSchema,
  createShiftSchema,
  createVehicleSchema,
  shiftActionSchema,
  updateVehicleSchema,
  type CreateDriverDto,
  type CreateShiftDto,
  type CreateVehicleDto,
  type ShiftActionDto,
  type UpdateVehicleDto,
} from '@blue-bee/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import type { RequestPrincipal } from '../auth/rbac/types';
import { DriverService, ShiftService, VehicleService } from './fleet.service';

/** Fleet management (PRD §9.5, §17.3 — vehicle/driver/shift = OWNER/DISPATCHER; CSR may view). */
@ApiTags('fleet')
@ApiBearerAuth()
@Controller()
@UseInterceptors(IdempotencyInterceptor)
export class FleetController {
  constructor(
    private readonly vehicles: VehicleService,
    private readonly drivers: DriverService,
    private readonly shifts: ShiftService,
  ) {}

  // ── vehicles ──
  @Post('vehicles')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a vehicle.' })
  createVehicle(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createVehicleSchema)) dto: CreateVehicleDto) {
    return this.vehicles.create(p, dto);
  }

  @Get('vehicles')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  @ApiOperation({ summary: 'List vehicles (org-scoped).' })
  listVehicles(@CurrentUser() p: RequestPrincipal) {
    return this.vehicles.list(p);
  }

  @Get('vehicles/:id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  getVehicle(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.vehicles.get(p, id);
  }

  @Patch('vehicles/:id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @ApiOperation({ summary: 'Update a vehicle (label/capacity/plate/status).' })
  updateVehicle(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(updateVehicleSchema)) dto: UpdateVehicleDto) {
    return this.vehicles.update(p, id, dto);
  }

  // ── drivers ──
  @Post('drivers')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a driver (an org user becomes a driver).' })
  createDriver(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createDriverSchema)) dto: CreateDriverDto) {
    return this.drivers.create(p, dto);
  }

  @Get('drivers')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  listDrivers(@CurrentUser() p: RequestPrincipal) {
    return this.drivers.list(p);
  }

  @Get('drivers/:id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  getDriver(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.drivers.get(p, id);
  }

  // ── shifts ──
  @Post('shifts')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Schedule a shift (driver + vehicle), status SCHEDULED.' })
  createShift(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createShiftSchema)) dto: CreateShiftDto) {
    return this.shifts.create(p, dto);
  }

  @Get('shifts')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  listShifts(@CurrentUser() p: RequestPrincipal) {
    return this.shifts.list(p);
  }

  @Get('shifts/:id')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER, RoleType.CSR)
  getShift(@CurrentUser() p: RequestPrincipal, @Param('id') id: string) {
    return this.shifts.get(p, id);
  }

  @Post('shifts/:id\\:start')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a shift (SCHEDULED → ACTIVE). Location emits only while active (Increment 5).' })
  startShift(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(shiftActionSchema)) dto: ShiftActionDto) {
    return this.shifts.start(p, id, dto);
  }

  @Post('shifts/:id\\:end')
  @Roles(RoleType.OWNER, RoleType.DISPATCHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a shift (ACTIVE → ENDED).' })
  endShift(@CurrentUser() p: RequestPrincipal, @Param('id') id: string, @Body(new ZodBody(shiftActionSchema)) dto: ShiftActionDto) {
    return this.shifts.end(p, id, dto);
  }
}
