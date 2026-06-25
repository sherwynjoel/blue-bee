import type {
  DriverAssignment,
  DriverStopAction,
  LocationBatchDto,
  LocationBatchResult,
  StopActionDto,
  StopExceptionDto,
} from '@blue-bee/shared';
import { ApiClient as BaseApiClient } from '@blue-bee/api-client';

/**
 * The Blue Bee driver-app API client — extends the shared transport (`@blue-bee/api-client`: auth,
 * single-flight 401→refresh→retry, problem+json→ApiError, push device-tokens) with the Increment-9
 * `/v1/driver/*` duty loop + `POST /v1/locations:batch`. The shared base is reused 1:1 by the
 * customer app; only these driver-specific endpoints live here.
 */
export class ApiClient extends BaseApiClient {
  // ───────────── driver duty loop (Increment 9) ─────────────

  getAssignment(): Promise<DriverAssignment> {
    return this.request('GET', '/driver/assignment');
  }

  startShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/start`, { body: {} });
  }

  endShift(shiftId: string): Promise<unknown> {
    return this.request('POST', `/driver/shifts/${shiftId}/end`, { body: {} });
  }

  /** Drive a §5.4 stop transition. fail/skip carry a reason; the rest an optional note. */
  stopAction(stopId: string, action: DriverStopAction, body: StopActionDto | StopExceptionDto = {}): Promise<unknown> {
    return this.request('POST', `/driver/stops/${stopId}/${action}`, { body });
  }

  // ───────────── location ingestion (Increment 5) ─────────────

  postLocations(batch: LocationBatchDto): Promise<LocationBatchResult> {
    return this.request('POST', '/locations:batch', { body: batch });
  }
}
