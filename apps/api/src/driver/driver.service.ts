import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DRIVER_ERRORS,
  type DriverAssignment,
  type DriverRouteView,
  type DriverShiftView,
  type DriverStopAction,
  type DriverStopView,
  RoleScope,
  RoleType,
  RouteStatus,
  ShiftStatus,
  type StopActionDto,
  type StopExceptionDto,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { ShiftService } from '../logistics/fleet.service';
import { RouteStopService } from '../logistics/route-stop.service';

/**
 * The driver-self-scoped duty-loop service (Increment 9). It owns ONE responsibility the proven
 * ops services don't: proving the caller's DRIVER profile OWNS the shift/route/stop they're acting
 * on — then it delegates the actual work to the Increment-4 `ShiftService` / `RouteStopService`
 * (the real §5.4 state machine + order-leg wiring + audit + atomic transitions). So this adds a
 * driver authorization boundary WITHOUT duplicating or weakening any proven logic, and without
 * touching the ops endpoints. Every query carries an explicit `org_id` (scoped-extension does not
 * apply off-request — the Increment-4/5 lesson).
 */
@Injectable()
export class DriverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftService,
    private readonly stops: RouteStopService,
  ) {}

  /** The caller's Driver profile (the duty loop is meaningless without one). */
  private async requireDriver(p: RequestPrincipal): Promise<{ id: string }> {
    const driver = await this.prisma.driver.findFirst({
      where: { userId: p.userId, orgId: p.orgId },
      select: { id: true },
    });
    if (!driver) throw new NotFoundException({ error: DRIVER_ERRORS.PROFILE_MISSING, message: 'no driver profile for this user' });
    return driver;
  }

  /**
   * GET /v1/driver/assignment — the one read the duty loop needs: the driver's current shift
   * (ACTIVE preferred, else the next SCHEDULED) and the workable route assigned to them, with
   * ordered stops + each destination's geo/address (joined from Site via PostGIS ST_X/ST_Y).
   */
  async getAssignment(p: RequestPrincipal): Promise<DriverAssignment> {
    const driver = await this.requireDriver(p);

    // Current shift: an ACTIVE one wins; otherwise the latest SCHEDULED. Never another driver's.
    // (Two explicit queries — Prisma orders enums by DEFINITION order, not by status preference.)
    const shiftSelect = { id: true, status: true, vehicleId: true, startedAt: true, endedAt: true } as const;
    const shiftRow =
      (await this.prisma.shift.findFirst({
        where: { orgId: p.orgId, driverId: driver.id, status: ShiftStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        select: shiftSelect,
      })) ??
      (await this.prisma.shift.findFirst({
        where: { orgId: p.orgId, driverId: driver.id, status: ShiftStatus.SCHEDULED },
        orderBy: { createdAt: 'desc' },
        select: shiftSelect,
      }));
    let shift: DriverShiftView | null = null;
    if (shiftRow) {
      const vehicle = await this.prisma.vehicle.findFirst({ where: { id: shiftRow.vehicleId, orgId: p.orgId }, select: { label: true } });
      shift = {
        id: shiftRow.id,
        status: shiftRow.status as unknown as string,
        vehicleId: shiftRow.vehicleId,
        vehicleLabel: vehicle?.label ?? null,
        startedAt: shiftRow.startedAt?.toISOString() ?? null,
        endedAt: shiftRow.endedAt?.toISOString() ?? null,
      };
    }

    // Workable route assigned to THIS driver (PUBLISHED/IN_PROGRESS); most recent date, newest first
    // on a tie (deterministic — a driver works one route at a time).
    const routeRow = await this.prisma.route.findFirst({
      where: { orgId: p.orgId, driverId: driver.id, status: { in: [RouteStatus.PUBLISHED, RouteStatus.IN_PROGRESS] } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, date: true, status: true },
    });

    let route: DriverRouteView | null = null;
    if (routeRow) {
      route = { id: routeRow.id, date: routeRow.date.toISOString(), status: routeRow.status as unknown as string, stops: await this.loadStops(p.orgId, routeRow.id) };
    }

    return { driverId: driver.id, shift, route };
  }

  /** Ordered stops for a route + each destination's site name/address/geo (PostGIS lat/lng). */
  private async loadStops(orgId: string, routeId: string): Promise<DriverStopView[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        seq: number;
        kind: string;
        status: string;
        order_id: string | null;
        site_name: string | null;
        address: string | null;
        lat: number | null;
        lng: number | null;
        time_window: unknown;
        eta: Date | null;
        eta_low: Date | null;
        eta_high: Date | null;
        exception_reason: string | null;
      }>
    >`
      SELECT rs.id,
             rs.seq,
             rs.kind::text                              AS kind,
             rs.status::text                            AS status,
             rs.order_id,
             s.name                                     AS site_name,
             s.address                                  AS address,
             ST_Y(s.geo::geometry)                      AS lat,
             ST_X(s.geo::geometry)                      AS lng,
             rs.time_window                             AS time_window,
             rs.eta, rs.eta_low, rs.eta_high,
             rs.exception_reason
        FROM "RouteStop" rs
        LEFT JOIN "Site" s ON s.id = rs.site_id AND s.org_id = ${orgId}::uuid
       WHERE rs.route_id = ${routeId}::uuid AND rs.org_id = ${orgId}::uuid
       ORDER BY rs.seq ASC`;

    return rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      kind: r.kind,
      status: r.status,
      orderId: r.order_id,
      siteName: r.site_name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      timeWindow: this.normalizeWindow(r.time_window),
      eta: r.eta?.toISOString() ?? null,
      etaLow: r.eta_low?.toISOString() ?? null,
      etaHigh: r.eta_high?.toISOString() ?? null,
      exceptionReason: r.exception_reason,
    }));
  }

  private normalizeWindow(raw: unknown): { start: string; end: string } | null {
    if (raw && typeof raw === 'object' && 'start' in raw && 'end' in raw) {
      const w = raw as { start: unknown; end: unknown };
      if (typeof w.start === 'string' && typeof w.end === 'string') return { start: w.start, end: w.end };
    }
    return null;
  }

  // ── shift lifecycle (own shift only) ──

  async startShift(p: RequestPrincipal, shiftId: string, dto: StopActionDto): Promise<unknown> {
    await this.assertOwnShift(p, shiftId);
    return this.shifts.start(this.asOrgScoped(p), shiftId, dto);
  }

  async endShift(p: RequestPrincipal, shiftId: string, dto: StopActionDto): Promise<unknown> {
    await this.assertOwnShift(p, shiftId);
    return this.shifts.end(this.asOrgScoped(p), shiftId, dto);
  }

  /**
   * A copy of the driver's principal carrying ORG read-scope, used ONLY for the delegated ops call.
   * The driver has ALREADY been verified to own the shift/stop (assertOwnShift/assertOwnStop, above),
   * so this is not a privilege escalation — it just lets the proven ops service resolve the org's row
   * (its scoped read otherwise confines to customers/staff, not drivers). userId/orgId are preserved,
   * so the audit actor stays the driver and the org boundary is unchanged.
   */
  private asOrgScoped(p: RequestPrincipal): RequestPrincipal {
    return { ...p, roles: [{ role: RoleType.DISPATCHER, scope: RoleScope.ORG, scopeId: null }] };
  }

  private async assertOwnShift(p: RequestPrincipal, shiftId: string): Promise<void> {
    const driver = await this.requireDriver(p);
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, orgId: p.orgId }, select: { driverId: true } });
    if (!shift) throw new NotFoundException({ error: DRIVER_ERRORS.NOT_OWN_SHIFT, message: 'shift not found' });
    if (shift.driverId !== driver.id) throw new ForbiddenException({ error: DRIVER_ERRORS.NOT_OWN_SHIFT, message: 'not your shift' });
  }

  // ── §5.4 stop actions (own route's stops only) ──

  async stopAction(p: RequestPrincipal, stopId: string, action: DriverStopAction, dto: StopActionDto | StopExceptionDto): Promise<unknown> {
    await this.assertOwnStop(p, stopId);
    const sp = this.asOrgScoped(p); // ownership already verified above; org-scope the delegated read
    switch (action) {
      case 'depart':
        return this.stops.depart(sp, stopId, dto as StopActionDto);
      case 'arrive':
        return this.stops.arrive(sp, stopId, dto as StopActionDto);
      case 'start':
        return this.stops.start(sp, stopId, dto as StopActionDto);
      case 'complete':
        return this.stops.complete(sp, stopId, dto as StopActionDto);
      case 'fail':
        return this.stops.fail(sp, stopId, dto as StopExceptionDto);
      case 'skip':
        return this.stops.skip(sp, stopId, dto as StopExceptionDto);
    }
  }

  private async assertOwnStop(p: RequestPrincipal, stopId: string): Promise<void> {
    const driver = await this.requireDriver(p);
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, orgId: p.orgId },
      select: { route: { select: { driverId: true } } },
    });
    if (!stop) throw new NotFoundException({ error: DRIVER_ERRORS.NOT_OWN_STOP, message: 'stop not found' });
    if (stop.route?.driverId !== driver.id) throw new ForbiddenException({ error: DRIVER_ERRORS.NOT_OWN_STOP, message: 'not a stop on your route' });
  }
}
