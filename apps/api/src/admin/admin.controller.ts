import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  RoleType,
  assignDriverVehicleSchema,
  assignRoleSchema,
  createDeviceSchema,
  type AssignDriverVehicleDto,
  type AssignRoleDto,
  type CreateDeviceDto,
} from '@blue-bee/shared';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AdminService } from './admin.service';

/**
 * Admin surface (Increment 16, PRD Epic B6.2 / §17.3) — **OWNER-gated** (the §17.3 admin row), org-scoped
 * in the service, every mutation audited. Read-only `/v1/admin/*` + audited writes (problem+json). A
 * non-OWNER role → 403 (RolesGuard). Vehicle/Driver CRUD is reused from the proven `/v1/vehicles` |
 * `/v1/drivers` (Inc-4, audited); this adds role assignment, devices, driver→vehicle assignment, and
 * the read-only notification-config + audit-log viewers.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ── users & roles ──
  @Get('users')
  @ApiOperation({ summary: 'List org users with their role grants (OWNER only). Org-scoped.' })
  listUsers(@CurrentUser() p: RequestPrincipal) {
    return this.admin.listUsers(p);
  }

  @Post('users/:userId/roles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Assign a role grant to an org user (audited). Returns the reflected grants.' })
  assignRole(
    @CurrentUser() p: RequestPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodBody(assignRoleSchema)) dto: AssignRoleDto,
  ) {
    return this.admin.assignRole(p, userId, dto);
  }

  @Delete('users/:userId/roles/:roleId')
  @ApiOperation({ summary: 'Revoke a role grant (audited). Blocks removing the last OWNER. Returns reflected grants.' })
  revokeRole(
    @CurrentUser() p: RequestPrincipal,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return this.admin.revokeRole(p, userId, roleId);
  }

  // ── devices ──
  @Get('devices')
  @ApiOperation({ summary: 'List org devices (push tokens masked).' })
  listDevices(@CurrentUser() p: RequestPrincipal) {
    return this.admin.listDevices(p);
  }

  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a device for an org user (audited).' })
  createDevice(@CurrentUser() p: RequestPrincipal, @Body(new ZodBody(createDeviceSchema)) dto: CreateDeviceDto) {
    return this.admin.createDevice(p, dto);
  }

  @Delete('devices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a device (audited).' })
  deleteDevice(@CurrentUser() p: RequestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteDevice(p, id);
  }

  // ── drivers (vehicle assignment) ──
  @Get('drivers')
  @ApiOperation({ summary: 'List org drivers + their default vehicle.' })
  listDrivers(@CurrentUser() p: RequestPrincipal) {
    return this.admin.listDrivers(p);
  }

  @Patch('drivers/:driverId')
  @ApiOperation({ summary: 'Assign (or clear, with null) a driver default vehicle (audited).' })
  assignDriverVehicle(
    @CurrentUser() p: RequestPrincipal,
    @Param('driverId', ParseUUIDPipe) driverId: string,
    @Body(new ZodBody(assignDriverVehicleSchema)) dto: AssignDriverVehicleDto,
  ) {
    return this.admin.assignDriverVehicle(p, driverId, dto);
  }

  // ── notification config (read-only) ──
  @Get('notification-config')
  @ApiOperation({ summary: 'Read-only viewer of the live event→channel matrix (templates are code-config, not editable).' })
  notificationConfig() {
    return this.admin.notificationConfig();
  }

  // ── audit-log viewer (read-only, paginated) ──
  @Get('audit-logs')
  @ApiOperation({ summary: 'Query the immutable audit log (filter by entity/actor/action/date; cursor-paginated).' })
  @ApiQuery({ name: 'entity', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO-8601 inclusive lower bound on `at`.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO-8601 exclusive upper bound on `at`.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size (default 50, max 200).' })
  auditLogs(
    @CurrentUser() p: RequestPrincipal,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.auditLogs(p, { entity, entityId, actorId, action, from, to, cursor, limit });
  }
}
