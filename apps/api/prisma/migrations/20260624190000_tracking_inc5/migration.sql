-- Increment 5 — Location ingestion + storage (tracking gateway data path).
-- Additive + reversible: the only schema change is a dedup unique index on the existing
-- GpsPing TimescaleDB hypertable (no new tables/columns; GpsPing was created in
-- 20260624000000_init_phase1 and converted to a hypertable there).

-- Dedup key for batched ping ingestion (PRD §6.2): a vehicle has at most one ping per
-- recorded_at instant. INSERT … ON CONFLICT (vehicle_id, recorded_at) DO NOTHING makes a
-- replayed/duplicate batch a no-op. The index covers the hypertable partition column
-- (recorded_at), satisfying Timescale's requirement that a unique index include the
-- partitioning key.
CREATE UNIQUE INDEX "GpsPing_vehicle_id_recorded_at_key" ON "GpsPing"("vehicle_id", "recorded_at");
