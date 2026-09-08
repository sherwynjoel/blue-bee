import type { GpsPingDto } from '@blue-bee/shared';

/**
 * PURE location logic (no native imports) so it is unit-tested AND reused by the integration proof:
 *   • `toPing` — normalize a device fix into the §9.5 `GpsPingDto` the API accepts (drops unknown
 *     sensor values that RN reports as -1, so they never fail the server's [0,360]/≥0 validators).
 *   • `pickIntervalMs` — the §10.4 duty cycle: tighter cadence near a stop, looser on the highway.
 *   • `LocationOutbox` — a bounded retry buffer: fixes accumulate, flush in batches, and on a network
 *     failure stay queued for the next flush. The backend's ON CONFLICT (vehicle_id, recorded_at)
 *     makes re-sends idempotent, so a retry never duplicates a ping (Increment 5).
 */

export interface DeviceFix {
  latitude: number;
  longitude: number;
  /** m/s; RN reports -1 when unknown. */
  speed?: number | null;
  /** degrees; RN reports -1 when unknown. */
  heading?: number | null;
  /** device capture time, epoch ms (authoritative for ordering). */
  timestampMs: number;
}

/** Normalize a device fix → GpsPingDto, dropping unknown/invalid sensor fields. */
export function toPing(fix: DeviceFix): GpsPingDto {
  const ping: GpsPingDto = {
    lat: fix.latitude,
    lng: fix.longitude,
    recordedAt: new Date(fix.timestampMs).toISOString(),
  };
  if (fix.speed != null && fix.speed >= 0) ping.speed = Math.min(fix.speed, 1000);
  if (fix.heading != null && fix.heading >= 0 && fix.heading <= 360) ping.heading = fix.heading;
  return ping;
}

/** Duty-cycle cadence (§6.2/§10.4): tight near a stop, loose on the highway. */
export const DUTY_CYCLE = {
  /** ~within this distance of the active stop → "approaching" cadence. */
  approachingRadiusM: 1500,
  approachingIntervalMs: 8_000, // 5–15 s band
  highwayIntervalMs: 45_000, // 30–60 s band
  /** Also emit after this much movement regardless of time. */
  distanceIntervalM: 60,
} as const;

/** Pick the emission interval from how close the driver is to the active stop. */
export function pickIntervalMs(distanceToStopM: number | null): number {
  if (distanceToStopM != null && distanceToStopM <= DUTY_CYCLE.approachingRadiusM) {
    return DUTY_CYCLE.approachingIntervalMs;
  }
  return DUTY_CYCLE.highwayIntervalMs;
}

export interface FlushResult {
  sent: number;
  remaining: number;
  ok: boolean;
}
export type SendBatch = (pings: GpsPingDto[]) => Promise<unknown>;

/**
 * A bounded FIFO of pending pings. Deduped by `recordedAt` and capped (oldest dropped past the cap,
 * counted) so a long offline stretch can't grow unbounded or drain the battery on a giant upload.
 */
export class LocationOutbox {
  private pending: GpsPingDto[] = [];
  private dropped = 0;

  constructor(
    private readonly cap = 1000,
    private readonly maxBatch = 200,
  ) {}

  enqueue(pings: GpsPingDto[]): void {
    if (pings.length === 0) return;
    const byTime = new Map<string, GpsPingDto>();
    for (const p of this.pending) byTime.set(p.recordedAt, p);
    for (const p of pings) byTime.set(p.recordedAt, p); // last write wins per instant
    let merged = [...byTime.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    if (merged.length > this.cap) {
      this.dropped += merged.length - this.cap;
      merged = merged.slice(merged.length - this.cap); // keep the freshest `cap`
    }
    this.pending = merged;
  }

  get size(): number {
    return this.pending.length;
  }
  get droppedCount(): number {
    return this.dropped;
  }
  peek(): readonly GpsPingDto[] {
    return this.pending;
  }

  /** Discard all pending pings. Used when a shift ends so its unsent pings never leak into the next shift. */
  clear(): void {
    this.pending = [];
  }

  /**
   * Send pending pings in batches. A batch that fails (throws) stays queued — we stop and report
   * `ok:false` with what remains, so the next flush retries it. Never throws.
   */
  async flush(send: SendBatch): Promise<FlushResult> {
    let sent = 0;
    while (this.pending.length > 0) {
      const batch = this.pending.slice(0, this.maxBatch);
      try {
        await send(batch);
      } catch {
        return { sent, remaining: this.pending.length, ok: false };
      }
      this.pending = this.pending.slice(batch.length);
      sent += batch.length;
    }
    return { sent, remaining: 0, ok: true };
  }
}
