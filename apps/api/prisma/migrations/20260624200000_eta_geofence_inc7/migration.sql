-- Increment 7 — Server-side ETA + geofence (predictive tracking layer).
-- Additive + reversible: new nullable columns on RouteStop + one unique index on GeofenceEvent.
-- No data backfill, no table/column drops, no type changes — safe on a populated table.

-- Server-side ETA on the stop (PRD §6.2): computed in-house behind the EtaEstimator seam,
-- EWMA-smoothed and surfaced as a RANGE. `eta` already existed (Increment 4 — the smoothed
-- point/"mid" arrival); these add the range bounds + the freshness/EWMA-memory stamp.
ALTER TABLE "RouteStop" ADD COLUMN "eta_low" TIMESTAMP(3);
ALTER TABLE "RouteStop" ADD COLUMN "eta_high" TIMESTAMP(3);
ALTER TABLE "RouteStop" ADD COLUMN "eta_computed_at" TIMESTAMP(3);

-- Geofence idempotency (PRD §6.4 / §9.5): each geofence type fires EXACTLY once per stop. This
-- unique constraint backs INSERT … ON CONFLICT (route_stop_id, type) DO NOTHING, so a re-entry
-- after GPS/traffic jitter — or a concurrent same-vehicle batch — appends zero duplicate rows.
-- (Reverse: DROP INDEX "GeofenceEvent_route_stop_id_type_key"; and DROP the three columns above.)
CREATE UNIQUE INDEX "GeofenceEvent_route_stop_id_type_key" ON "GeofenceEvent"("route_stop_id", "type");
