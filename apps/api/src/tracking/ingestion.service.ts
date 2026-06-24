import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RoleType, ShiftStatus, TRACKING_ERRORS, type LocationBatchDto, type LocationBatchResult } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import type { RequestPrincipal } from '../auth/rbac/types';
import { AuditService } from '../orders/audit.service';
import { RealtimePublisher } from '../realtime/realtime-publisher.service';
import { GpsHistoryService, type HistoryRow } from './gps-history.service';
import { LastKnownStore } from './last-known.store';
import { TrackingPredictionService } from './tracking-prediction.service';
import { dedupePings, newestPing } from './tracking-util';

/**
 * Location ingestion (PRD §6.2/§10.4 stateless ingestion, §11.1 `POST /locations:batch`,
 * §12.2 privacy). Accepts a batch of GPS pings for one ACTIVE shift + vehicle and fans them
 * to the two real stores.
 *
 * Gating (privacy + scope), all server-side:
 *  • SHIFT-GATED — pings are accepted only for an ACTIVE shift; an ended/missing shift is
 *    rejected (404 not-found / 409 not-active) and NOTHING is stored (§6.2/§12.2 "never
 *    track outside an active shift").
 *  • SCOPED — the shift is loaded through the scoped Prisma client (org boundary); the batch
 *    vehicle must be the shift's vehicle (422 on mismatch); a DRIVER may post ONLY for their
 *    own active shift (403 cross-driver); OWNER may post for any org shift (ops/backfill).
 *  • ROBUST — pings are deduped in-batch by (vehicleId, recordedAt); recorded_at is
 *    authoritative for "latest", so out-of-order / duplicate / replayed pings are handled.
 *
 * Write order keeps the hot store fresh even if history is momentarily throttled (§10.4
 * "keep last-known fresh, thin the history"): the Redis last-known CAS runs FIRST (it only
 * advances on a strictly-newer recorded_at), then the Timescale history append. If the
 * append fails the caller gets an error and retries; the CAS is a no-op on the (now non-newer)
 * retry and the hypertable insert is idempotent — so a retry reconciles both stores.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly history: GpsHistoryService,
    private readonly lastKnown: LastKnownStore,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
    private readonly prediction: TrackingPredictionService,
  ) {}

  async ingest(principal: RequestPrincipal, dto: LocationBatchDto): Promise<LocationBatchResult> {
    const db = scopedPrisma(this.prisma, principal);

    // ── Shift gate (org-scoped load → 404; status → 409) ──
    const shift = await db.shift.findUnique({ where: { id: dto.shiftId } });
    if (!shift) {
      throw new NotFoundException({ error: TRACKING_ERRORS.SHIFT_NOT_FOUND, message: `Shift ${dto.shiftId} not found` });
    }
    if ((shift.status as unknown as ShiftStatus) !== ShiftStatus.ACTIVE) {
      throw new ConflictException({
        error: TRACKING_ERRORS.SHIFT_NOT_ACTIVE,
        message: `Shift is ${shift.status}; location is only accepted during an ACTIVE shift (§6.2)`,
      });
    }

    // ── Vehicle must be the shift's vehicle (no cross-vehicle injection) ──
    if (shift.vehicleId !== dto.vehicleId) {
      throw new UnprocessableEntityException({
        error: TRACKING_ERRORS.VEHICLE_MISMATCH,
        message: `vehicleId ${dto.vehicleId} is not the vehicle on shift ${dto.shiftId}`,
      });
    }

    // ── Horizontal scope: a DRIVER may post only for their OWN shift; OWNER may backfill any. ──
    const isOwner = principal.roles.some((r) => r.role === RoleType.OWNER);
    if (!isOwner) {
      const driver = await db.driver.findUnique({ where: { userId: principal.userId } });
      if (!driver) {
        throw new ForbiddenException({
          error: TRACKING_ERRORS.DRIVER_PROFILE_MISSING,
          message: 'No driver profile for the caller; cannot post location',
        });
      }
      if (shift.driverId !== driver.id) {
        throw new ForbiddenException({
          error: TRACKING_ERRORS.NOT_OWN_SHIFT,
          message: 'A driver may post location only for their own active shift',
        });
      }
    }

    // ── Dedup in-batch by recorded_at (vehicle is constant); recorded_at is authoritative. ──
    const deduped = dedupePings(dto.pings);
    const newest = newestPing(deduped);
    const rows: HistoryRow[] = deduped.map((p) => ({
      id: randomUUID(),
      orgId: principal.orgId,
      shiftId: shift.id,
      vehicleId: shift.vehicleId,
      lat: p.lat,
      lng: p.lng,
      speed: p.speed,
      heading: p.heading,
      recordedAt: p.recordedAt,
      createdBy: principal.userId,
    }));

    // ── Hot store FIRST (recorded_at-authoritative, atomic) so last-known stays fresh. ──
    const lastKnownUpdated = await this.lastKnown.update({
      orgId: principal.orgId,
      vehicleId: shift.vehicleId,
      shiftId: shift.id,
      lat: newest.lat,
      lng: newest.lng,
      speed: newest.speed,
      heading: newest.heading,
      recordedAtMs: newest.recordedAt.getTime(),
      recordedAtIso: newest.recordedAt.toISOString(),
    });

    // ── History append (idempotent multi-row insert; replay → 0 rows). ──
    const inserted = await this.history.appendBatch(rows);

    await this.audit.record({
      orgId: principal.orgId,
      actorId: principal.userId,
      entity: 'Shift',
      entityId: shift.id,
      action: 'LOCATIONS_INGESTED',
      after: { vehicleId: shift.vehicleId, received: dto.pings.length, accepted: rows.length, inserted, newestRecordedAt: newest.recordedAt.toISOString() },
    });

    const lastKnown = await this.lastKnown.readOne(principal.orgId, shift.vehicleId);

    // ── Realtime fan-out (Increment 6) — keep the ON-THE-WIRE stream monotonic, not just the
    // store. A stale/out-of-order batch (lastKnownUpdated=false) never emits. For an advancing
    // batch we emit the AUTHORITATIVE readback head, and only if this batch is STILL the head
    // (its recordedAt === the head's): under concurrent same-vehicle batches, a batch that
    // advanced the store but was already superseded by a newer concurrent batch skips its now-
    // stale emit — so the subscriber never sees a backwards jump (QC: publish ordering). ──
    if (lastKnownUpdated && lastKnown && Date.parse(lastKnown.recordedAt) === newest.recordedAt.getTime()) {
      this.realtime.publishPosition(principal.orgId, shift.vehicleId, {
        vehicleId: shift.vehicleId,
        lat: lastKnown.lat,
        lng: lastKnown.lng,
        speed: lastKnown.speed,
        heading: lastKnown.heading,
        recordedAt: lastKnown.recordedAt,
      });

      // Increment 7 — predictive layer on the SAME genuine-advance gate (the §10.4 ping cluster):
      // recompute the active-stop ETA + evaluate geofence off the AUTHORITATIVE head position.
      // Degradation-wrapped inside the service (it never throws), so it cannot fail this ingest;
      // awaited so the persisted ETA is fresh for the immediately-following REST tracking read.
      await this.prediction.onLastKnownAdvance(principal.orgId, shift.vehicleId, { lat: lastKnown.lat, lng: lastKnown.lng });
    }

    return {
      vehicleId: shift.vehicleId,
      shiftId: shift.id,
      received: dto.pings.length,
      accepted: rows.length,
      inserted,
      lastKnownUpdated,
      lastKnown,
    };
  }
}
