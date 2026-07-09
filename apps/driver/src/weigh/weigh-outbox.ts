import type { WeightCaptureResult } from '@blue-bee/shared';

/**
 * Durable, honest weigh send-queue (Inc-23 P2) — the offline-first seam for driver weight approvals,
 * modelled 1:1 on the proven `ChatOutbox` contract. A driver at a pickup with no signal must be able to
 * APPROVE a weight and have it sync later; the approval is queued + persisted BEFORE any network attempt.
 *
 * THE CONTRACT (offline honesty):
 *  • An approval is ENQUEUED (status `queued`) and persisted BEFORE the network call.
 *  • flush() sends queued items IN ORDER. An item is removed (confirmed) ONLY after the server responds —
 *    never optimistically. A TRANSIENT failure (offline / 5xx) leaves it `queued` and STOPS the flush
 *    (retried on the next trigger). A PERMANENT rejection (4xx) marks it `failed` and is surfaced, not
 *    retried forever.
 *  • A retry reuses the item's `idempotencyKey`, so a re-send of the SAME approval is de-duped server-side.
 *    A RE-WEIGH mints a fresh key (a new immutable capture) — the outbox never regenerates a key on retry.
 */
export interface WeighQueueItem {
  /** Local id (distinct from the server capture id assigned on confirmation). */
  id: string;
  stopId: string;
  /** A short order label for the queued-list UI (never used for the request). */
  orderLabel: string | null;
  weightKg: number;
  weighPoint: 'PICKUP' | 'PLANT';
  source?: string;
  note?: string;
  /** Stable per-approval key → a retry of the SAME approval is de-duped server-side. */
  idempotencyKey: string;
  createdAt: string;
  status: 'queued' | 'failed';
  error?: string;
}

export interface WeighOutboxStore {
  load(): Promise<WeighQueueItem[]>;
  save(items: WeighQueueItem[]): Promise<void>;
}

/** In-memory store for tests + the integration proof (no native import). */
export class MemoryWeighOutboxStore implements WeighOutboxStore {
  private data: WeighQueueItem[];
  saveCount = 0;
  constructor(seed: WeighQueueItem[] = []) {
    this.data = seed.map((x) => ({ ...x }));
  }
  async load(): Promise<WeighQueueItem[]> {
    return this.data.map((x) => ({ ...x }));
  }
  async save(items: WeighQueueItem[]): Promise<void> {
    this.saveCount += 1;
    this.data = items.map((x) => ({ ...x }));
  }
  /** Test helper — what's durably persisted right now (survives a simulated relaunch). */
  snapshot(): WeighQueueItem[] {
    return this.data.map((x) => ({ ...x }));
  }
}

export type SendWeigh = (item: WeighQueueItem) => Promise<WeightCaptureResult>;

export interface WeighFlushResult {
  confirmed: WeightCaptureResult[];
  sent: number;
  remaining: number;
  failed: number;
  /** True when the flush drained all queued work without a transient stop. */
  ok: boolean;
}

interface OutboxDeps {
  nowIso?: () => string;
  genId?: () => string;
  cap?: number;
}

export interface EnqueueWeighInput {
  stopId: string;
  orderLabel: string | null;
  weightKg: number;
  weighPoint: 'PICKUP' | 'PLANT';
  source?: string;
  note?: string;
}

export class WeighOutbox {
  private items: WeighQueueItem[] = [];
  private loaded = false;

  constructor(
    private readonly store: WeighOutboxStore,
    private readonly deps: OutboxDeps = {},
  ) {}

  /** Restore persisted items (call once on mount — realises durable cross-relaunch persistence). */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.items = await this.store.load();
    this.loaded = true;
  }

  list(): readonly WeighQueueItem[] {
    return this.items;
  }
  pendingCount(): number {
    return this.items.filter((i) => i.status === 'queued').length;
  }
  hasWork(): boolean {
    return this.items.some((i) => i.status === 'queued');
  }

  /** Enqueue an approval (persisted immediately) and return the tracked item. */
  async enqueue(input: EnqueueWeighInput, idempotencyKey: string): Promise<WeighQueueItem> {
    const item: WeighQueueItem = {
      id: this.genId(),
      stopId: input.stopId,
      orderLabel: input.orderLabel,
      weightKg: input.weightKg,
      weighPoint: input.weighPoint,
      ...(input.source ? { source: input.source } : {}),
      ...(input.note ? { note: input.note } : {}),
      idempotencyKey,
      createdAt: this.now(),
      status: 'queued',
    };
    this.items = [...this.items, item];
    const cap = this.deps.cap ?? 200;
    if (this.items.length > cap) {
      // Evict TERMINAL (failed) items first — oldest first — so a still-queued approval is never dropped
      // ahead of a permanently-failed one; last resort drops the oldest.
      let excess = this.items.length - cap;
      const failedOldestFirst = this.items.filter((i) => i.status === 'failed').map((i) => i.id);
      const evict = new Set(failedOldestFirst.slice(0, excess));
      if (evict.size) this.items = this.items.filter((i) => !evict.has(i.id));
      excess = this.items.length - cap;
      if (excess > 0) this.items = this.items.slice(excess);
    }
    await this.persist();
    return item;
  }

  /**
   * Deliver queued items in order. Confirmed items leave the queue; a transient failure stops (stays
   * queued for the next trigger); a permanent failure is marked `failed` and skipped. NEVER throws and
   * NEVER reports an item sent unless the server responded.
   */
  async flush(send: SendWeigh, isPermanent?: (err: unknown) => boolean): Promise<WeighFlushResult> {
    const confirmed: WeightCaptureResult[] = [];
    let stoppedTransient = false;

    for (const item of [...this.items]) {
      if (item.status !== 'queued') continue;
      try {
        const res = await send(item);
        this.items = this.items.filter((i) => i.id !== item.id); // confirmed → leaves the queue
        confirmed.push(res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isPermanent?.(err)) {
          this.items = this.items.map((i) => (i.id === item.id ? { ...i, status: 'failed', error: message } : i));
          continue;
        }
        this.items = this.items.map((i) => (i.id === item.id ? { ...i, error: message } : i));
        stoppedTransient = true;
        break;
      }
    }

    await this.persist();
    return {
      confirmed,
      sent: confirmed.length,
      remaining: this.items.filter((i) => i.status === 'queued').length,
      failed: this.items.filter((i) => i.status === 'failed').length,
      ok: !stoppedTransient,
    };
  }

  private now(): string {
    return this.deps.nowIso ? this.deps.nowIso() : new Date().toISOString();
  }
  private genId(): string {
    return this.deps.genId ? this.deps.genId() : `weigh-local-${this.now()}-${Math.round(Math.random() * 1e9)}`;
  }
  private async persist(): Promise<void> {
    await this.store.save(this.items);
  }
}
