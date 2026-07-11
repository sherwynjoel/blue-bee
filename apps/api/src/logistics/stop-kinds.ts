import { RouteStopKind } from '@blue-bee/shared';

/**
 * Stop kinds that include a DELIVERY operation — a pure delivery, or a combined pickup+delivery (`BOTH`).
 *
 * The single source of truth for "is this stop a delivery?", shared by the driver POD pre-check
 * (`driver.service.ts`) and the shared stop applier (`route-stop.service.ts` — the POD gate + the
 * delivery order-legs), so the two can never disagree about which stops require proof of delivery.
 */
export const DELIVERY_KINDS: ReadonlySet<RouteStopKind> = new Set([RouteStopKind.DELIVERY, RouteStopKind.BOTH]);
