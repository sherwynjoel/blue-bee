import { Injectable, Logger } from '@nestjs/common';
import { GeofenceEventType } from '@blue-bee/shared';
import { EtaService } from './eta.service';
import { GeofenceService, type FiredGeofence } from './geofence.service';
import type { GeoPoint } from './eta-math';
import { NotificationService, type GeofenceNotification } from '../notifications/notification.service';

/**
 * The predictive layer (Increment 7) hung off the ingestion advance-hook: recompute the ETA for
 * the vehicle's active stop, then evaluate geofence (reusing the ETA's distance). The caller
 * invokes this ONLY on a genuine last-known advance (the Lua-CAS monotonicity gate = the §10.4
 * "ping cluster" sampling), passing the AUTHORITATIVE head position.
 *
 * DEGRADATION (PRD §12.3): ETA + geofence are an OPTIMIZATION on top of the data path. Any failure
 * — estimator throw, a bad geo row, Redis/DB hiccup — is swallowed + logged here so it can NEVER
 * fail `POST /locations:batch`. The REST last-known + the §5.4 status timeline remain the source of
 * truth, so a dropped recompute just means the next advance recomputes.
 */
@Injectable()
export class TrackingPredictionService {
  private readonly logger = new Logger(TrackingPredictionService.name);

  constructor(
    private readonly eta: EtaService,
    private readonly geofence: GeofenceService,
    private readonly notifications: NotificationService,
  ) {}

  async onLastKnownAdvance(orgId: string, vehicleId: string, position: GeoPoint): Promise<void> {
    try {
      const active = await this.eta.recomputeForVehicle(orgId, vehicleId, position);
      if (!active) return;
      const fired = await this.geofence.evaluate(orgId, vehicleId, active);
      // Notifications are the LAST, most-optional step: a geofence crossing that was newly written
      // raises customer alerts (Increment 8). Wrapped separately so a notification failure cannot
      // undo the (already-committed) geofence write or ETA — and never reaches the ingest path.
      if (fired.length > 0) {
        try {
          await this.notifications.dispatchGeofence(orgId, fired.map(toNotification));
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(`notification dispatch skipped for vehicle ${vehicleId} (org ${orgId}): ${reason}`);
        }
      }
    } catch (err) {
      // Any thrown value is tolerated (a non-Error throw must still log meaningfully, not "undefined").
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ETA/geofence skipped for vehicle ${vehicleId} (org ${orgId}): ${reason}`);
    }
  }
}

/** Map a fired geofence event to the notification engine's dispatch input. */
function toNotification(f: FiredGeofence): GeofenceNotification {
  return {
    geofenceEventId: f.geofenceEventId,
    kind: f.type === GeofenceEventType.ARRIVED ? 'ARRIVED' : 'APPROACHING',
    orderId: f.orderId,
    stopId: f.stopId,
    vehicleId: f.vehicleId,
    occurredAt: f.occurredAt,
    etaSeconds: f.etaSeconds,
  };
}
