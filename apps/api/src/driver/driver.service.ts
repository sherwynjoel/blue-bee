import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Photo } from '@prisma/client';
import {
  type CaptureProofOfDeliveryDto,
  type CaptureWeightDto,
  DRIVER_ERRORS,
  type DriverAssignment,
  type DriverRouteView,
  type DriverShiftView,
  type DriverStopAction,
  type DriverStopView,
  type OrderWeightView,
  POD_ERRORS,
  type PodMediaView,
  type PresignMediaResult,
  type PresignPodMediaDto,
  type ProofOfDeliveryView,
  RoleScope,
  RoleType,
  RouteStatus,
  RouteStopKind,
  ShiftStatus,
  type StopActionDto,
  type StopExceptionDto,
  type WeightCaptureResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { WeighService } from '../orders/weigh.service';
import { MediaService } from '../media/media.service';
import { ShiftService } from '../logistics/fleet.service';
import { RouteStopService } from '../logistics/route-stop.service';
import { DELIVERY_KINDS } from '../logistics/stop-kinds';

/** The own-stop fields the duty loop + POD flow need (kind/orderId gate the POD precondition). */
interface OwnedStop {
  id: string;
  orgId: string;
  orderId: string | null;
  kind: RouteStopKind;
}

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
    private readonly media: MediaService,
    private readonly audit: AuditService,
    private readonly weigh: WeighService,
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
    const stop = await this.requireOwnStop(p, stopId);
    // Delivery POD gate (Increment 17, additive — driver layer only, the §5.4 graph + ops path +
    // pickup stops are untouched): a DELIVERY/BOTH stop cannot be COMPLETED until its POD is captured.
    // Checked BEFORE delegating, so a missing POD never enters the state machine — a clean 4xx, no
    // half-applied transition. (Ops `/v1/route-stops` keeps its admin-override complete, ungated.)
    if (action === 'complete' && DELIVERY_KINDS.has(stop.kind)) {
      const pod = await this.prisma.proofOfDelivery.findFirst({ where: { routeStopId: stop.id, orgId: p.orgId }, select: { id: true } });
      if (!pod) {
        throw new BadRequestException({ error: POD_ERRORS.POD_REQUIRED, message: 'capture proof of delivery before completing this delivery stop' });
      }
    }
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

  /** Verify the caller's Driver profile owns the stop (route.driverId + org), returning the fields the
   *  duty loop + POD flow need. 404 (no such stop in org) / 403 (not on your route). */
  private async requireOwnStop(p: RequestPrincipal, stopId: string): Promise<OwnedStop> {
    const driver = await this.requireDriver(p);
    const stop = await this.prisma.routeStop.findFirst({
      where: { id: stopId, orgId: p.orgId },
      select: { id: true, orgId: true, orderId: true, kind: true, route: { select: { driverId: true } } },
    });
    if (!stop) throw new NotFoundException({ error: DRIVER_ERRORS.NOT_OWN_STOP, message: 'stop not found' });
    if (stop.route?.driverId !== driver.id) throw new ForbiddenException({ error: DRIVER_ERRORS.NOT_OWN_STOP, message: 'not a stop on your route' });
    return { id: stop.id, orgId: stop.orgId, orderId: stop.orderId, kind: stop.kind as unknown as RouteStopKind };
  }

  // ── proof of delivery (Increment 17): photo + signature + geo at a DELIVERY stop ──

  /** POD applies only to a DELIVERY/BOTH stop that has an order to attribute the evidence to. */
  private assertDeliveryStopWithOrder(stop: OwnedStop): string {
    if (!DELIVERY_KINDS.has(stop.kind)) {
      throw new BadRequestException({ error: POD_ERRORS.STOP_NOT_DELIVERY, message: 'proof of delivery applies only to delivery stops' });
    }
    if (!stop.orderId) {
      throw new BadRequestException({ error: POD_ERRORS.STOP_HAS_NO_ORDER, message: 'this stop has no order to attach proof of delivery to' });
    }
    return stop.orderId;
  }

  // ── weigh a load at MY stop (Inc-23 P2): driver-self-scoped weight capture → the Inc-22 hybrid gate ──

  /** Load the stop's order (must exist) for a weigh — the weigh capture attaches to it. */
  private async requireStopOrder(stop: OwnedStop): Promise<import('@prisma/client').Order> {
    if (!stop.orderId) {
      throw new BadRequestException({ error: POD_ERRORS.STOP_HAS_NO_ORDER, message: 'this stop has no order to weigh' });
    }
    const order = await this.prisma.order.findFirst({ where: { id: stop.orderId, orgId: stop.orgId } });
    if (!order) throw new NotFoundException({ error: DRIVER_ERRORS.NOT_OWN_STOP, message: 'the stop order was not found' });
    return order;
  }

  /**
   * Approve a weighed load at MY stop → an APPEND-ONLY weight capture + the Inc-22 hybrid pricing gate.
   * Authorized by STOP OWNERSHIP (a driver has no direct order-write). Idempotent (the controller's
   * Idempotency-Key): same key = the first capture, a new key = a re-weigh (new immutable capture).
   */
  async weighLoad(p: RequestPrincipal, stopId: string, dto: CaptureWeightDto): Promise<WeightCaptureResult> {
    const stop = await this.requireOwnStop(p, stopId);
    const order = await this.requireStopOrder(stop);
    return this.weigh.weighForOrder(p, order, dto);
  }

  /** The authoritative weight + append-only history + the customer estimate for MY stop's order. */
  async getStopWeight(p: RequestPrincipal, stopId: string): Promise<OrderWeightView> {
    const stop = await this.requireOwnStop(p, stopId);
    const order = await this.requireStopOrder(stop);
    return this.weigh.weightViewForOrder(order);
  }

  /** Presign a POD photo/signature upload for MY delivery stop (the order comes from the stop). */
  async presignPodMedia(p: RequestPrincipal, stopId: string, dto: PresignPodMediaDto): Promise<PresignMediaResult> {
    const stop = await this.requireOwnStop(p, stopId);
    const orderId = this.assertDeliveryStopWithOrder(stop);
    return this.media.presignForStop(p, orderId, dto);
  }

  /**
   * Capture proof of delivery for MY delivery stop: HEAD-verify each referenced media object (presigned
   * for THIS stop's order), link the delivery photo(s) + the signature to the POD, store the signature
   * key + the optional device geo, and stamp capturedBy/At. Idempotent on the stop's unique POD row —
   * re-submitting is safe. Audited. Never trusts a client URL (only confirmed object keys).
   */
  async captureProofOfDelivery(p: RequestPrincipal, stopId: string, dto: CaptureProofOfDeliveryDto): Promise<ProofOfDeliveryView> {
    const stop = await this.requireOwnStop(p, stopId);
    const orderId = this.assertDeliveryStopWithOrder(stop);

    // 1) Confirm (head-verify) every key against THIS stop's order — idempotent, returns the Photos.
    const signaturePhoto = await this.media.confirmForStop(p, dto.signatureStorageKey, orderId);
    const linked: Photo[] = [signaturePhoto];
    const seen = new Set<string>([signaturePhoto.id]);
    for (const key of dto.photoStorageKeys) {
      const photo = await this.media.confirmForStop(p, key, orderId);
      if (!seen.has(photo.id)) {
        seen.add(photo.id);
        linked.push(photo);
      }
    }

    // 2) Upsert the POD (unique routeStopId → idempotent) + link photos + geo + audit, atomically.
    await this.prisma.$transaction(async (tx) => {
      const pod = await tx.proofOfDelivery.upsert({
        where: { routeStopId: stop.id },
        create: { orgId: stop.orgId, routeStopId: stop.id, signatureKey: signaturePhoto.storageKey, capturedBy: p.userId, createdBy: p.userId },
        update: { signatureKey: signaturePhoto.storageKey, capturedBy: p.userId, capturedAt: new Date() },
      });
      for (const photo of linked) {
        await tx.photo.updateMany({ where: { id: photo.id, orgId: stop.orgId }, data: { podId: pod.id } });
      }
      if (dto.geo) {
        await tx.$executeRaw`
          UPDATE "ProofOfDelivery" SET geo = ST_SetSRID(ST_MakePoint(${dto.geo.lng}, ${dto.geo.lat}), 4326)::geography
          WHERE id = ${pod.id}::uuid`;
      }
      await this.audit.record(
        { orgId: stop.orgId, actorId: p.userId, entity: 'ProofOfDelivery', entityId: pod.id, action: 'POD_CAPTURED', after: { routeStopId: stop.id, photoCount: linked.length - 1, hasSignature: true, hasGeo: !!dto.geo } },
        tx,
      );
    });

    return (await this.podView(stop.orgId, stop.id))!;
  }

  /** Read MY stop's captured POD (signed reads) — for showing it on the completed stop. */
  async getProofOfDelivery(p: RequestPrincipal, stopId: string): Promise<ProofOfDeliveryView> {
    const stop = await this.requireOwnStop(p, stopId);
    const view = await this.podView(stop.orgId, stop.id);
    if (!view) throw new NotFoundException({ error: POD_ERRORS.POD_REQUIRED, message: 'no proof of delivery captured for this stop' });
    return view;
  }

  /** Build the POD view — geo via PostGIS ST_X/ST_Y; each object as a freshly-minted signed GET (§14). */
  private async podView(orgId: string, routeStopId: string): Promise<ProofOfDeliveryView | null> {
    const pod = await this.prisma.proofOfDelivery.findFirst({ where: { routeStopId, orgId }, include: { photos: true } });
    if (!pod) return null;
    const geoRows = await this.prisma.$queryRaw<Array<{ lng: number | null; lat: number | null }>>`
      SELECT ST_X(geo::geometry) AS lng, ST_Y(geo::geometry) AS lat FROM "ProofOfDelivery" WHERE id = ${pod.id}::uuid`;
    const g = geoRows[0];
    const geo = g && g.lng != null && g.lat != null ? { lng: g.lng, lat: g.lat } : null;
    const toView = async (ph: Photo): Promise<PodMediaView> => ({
      id: ph.id,
      storageKey: ph.storageKey,
      contentType: ph.contentType,
      sizeBytes: ph.sizeBytes,
      downloadUrl: await this.media.signedGetFor(ph),
    });
    const signature = pod.signatureKey ? (pod.photos.find((ph) => ph.storageKey === pod.signatureKey) ?? null) : null;
    const photos = pod.photos.filter((ph) => ph.storageKey !== pod.signatureKey);
    return {
      id: pod.id,
      routeStopId: pod.routeStopId,
      capturedAt: pod.capturedAt.toISOString(),
      capturedBy: pod.capturedBy,
      geo,
      signature: signature ? await toView(signature) : null,
      photos: await Promise.all(photos.map(toView)),
    };
  }
}
