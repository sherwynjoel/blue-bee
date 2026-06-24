import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { LastKnownPosition } from '@blue-bee/shared';
import { REDIS } from '../redis/redis.module';
import { parseLastKnownHash } from './tracking-util';

/**
 * Live last-known location store (PRD §6.2 "Live location store: Redis geo + last-known",
 * §10.4). This is the HOT read source for `GET /fleet/live` and the customer tracking poll.
 *
 * Two real Redis structures per org:
 *  • a **GEO sorted set** `bb:fleetgeo:{org}` (GEOADD) so nearest-vehicle queries are
 *    available later (GEOSEARCH) — Increment 6 ETA/geofence will use it.
 *  • a per-vehicle **hash** `bb:lastknown:{org}:{vehicleId}` holding the full last-known
 *    position + a freshness timestamp (`recordedAtMs`).
 *
 * The write is `recorded_at`-AUTHORITATIVE and atomic: a single Lua script compare-and-sets
 * — it only advances the stored position when the incoming `recordedAt` is strictly newer
 * than what's stored. Because Redis runs the script atomically, this is correct under a
 * burst of concurrent batches for the same vehicle (out-of-order / duplicate / replayed
 * pings can never regress the last-known). Keys are namespaced by org (explicit tenant
 * scoping — the Increment-4 defense-in-depth lesson applies to the cache too).
 */

export interface LastKnownInput {
  orgId: string;
  vehicleId: string;
  shiftId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  /** Device capture time (ms epoch) — the CAS comparison key. */
  recordedAtMs: number;
  /** Device capture time (ISO-8601) — stored for output. */
  recordedAtIso: string;
}

/**
 * Atomic recorded_at-authoritative upsert. KEYS[1]=geo set, KEYS[2]=meta hash.
 * Returns 1 if the last-known advanced, 0 if the incoming ping was stale (≤ stored).
 */
const CAS_UPDATE_LUA = `
local geoKey = KEYS[1]
local metaKey = KEYS[2]
local newMs = tonumber(ARGV[1])
local stored = redis.call('HGET', metaKey, 'recordedAtMs')
if stored and tonumber(stored) >= newMs then
  return 0
end
local lng = ARGV[2]
local lat = ARGV[3]
local vehicleId = ARGV[9]
redis.call('GEOADD', geoKey, lng, lat, vehicleId)
redis.call('HSET', metaKey,
  'vehicleId', vehicleId,
  'lng', lng,
  'lat', lat,
  'speed', ARGV[4],
  'heading', ARGV[5],
  'shiftId', ARGV[6],
  'recordedAt', ARGV[7],
  'recordedAtMs', ARGV[1],
  'updatedAtMs', ARGV[8])
return 1
`;

@Injectable()
export class LastKnownStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private geoKey(orgId: string): string {
    return `bb:fleetgeo:${orgId}`;
  }

  private metaKey(orgId: string, vehicleId: string): string {
    return `bb:lastknown:${orgId}:${vehicleId}`;
  }

  /**
   * Advance a vehicle's last-known iff `recordedAtMs` is newer than what's stored (atomic).
   * Returns true when the position advanced, false when the incoming ping was stale.
   */
  async update(input: LastKnownInput): Promise<boolean> {
    const res = (await this.redis.eval(
      CAS_UPDATE_LUA,
      2,
      this.geoKey(input.orgId),
      this.metaKey(input.orgId, input.vehicleId),
      String(input.recordedAtMs),
      String(input.lng),
      String(input.lat),
      input.speed === null ? '' : String(input.speed),
      input.heading === null ? '' : String(input.heading),
      input.shiftId,
      input.recordedAtIso,
      String(Date.now()),
      input.vehicleId,
    )) as number;
    return res === 1;
  }

  /** Read one vehicle's last-known from Redis (null if it has never pinged). */
  async readOne(orgId: string, vehicleId: string): Promise<LastKnownPosition | null> {
    const hash = await this.redis.hgetall(this.metaKey(orgId, vehicleId));
    return parseLastKnownHash(vehicleId, hash, Date.now());
  }

  /**
   * Read last-known for many vehicles in one pipeline. Returns only those present in Redis
   * (callers fall back to Timescale for the rest).
   */
  async readMany(orgId: string, vehicleIds: string[]): Promise<Map<string, LastKnownPosition>> {
    const out = new Map<string, LastKnownPosition>();
    if (vehicleIds.length === 0) return out;
    const pipeline = this.redis.pipeline();
    for (const id of vehicleIds) pipeline.hgetall(this.metaKey(orgId, id));
    const results = await pipeline.exec();
    if (!results) return out;
    const nowMs = Date.now();
    results.forEach(([err, hash], i) => {
      if (err) return;
      const parsed = parseLastKnownHash(vehicleIds[i], hash as Record<string, string>, nowMs);
      if (parsed) out.set(vehicleIds[i], parsed);
    });
    return out;
  }
}
