import type { ChatMessageDto } from '@blue-bee/shared';
import type { OutboxItem, OutboxStore } from './outbox-store';

/**
 * Durable, honest chat send-queue (Increment 18) — the offline-first seam for driver messages,
 * modelled on `LocationOutbox`'s contract but persisted (survives relaunch) and per-message-tracked.
 *
 * THE CONTRACT (offline honesty — 6-lens #5):
 *  • A composed message is ENQUEUED (status `queued`) and persisted BEFORE any network attempt.
 *  • flush() sends queued items IN ORDER. An item is removed (confirmed) ONLY after the server
 *    responds — we NEVER mark a message delivered optimistically. A TRANSIENT failure (offline / 5xx)
 *    leaves it `queued` and STOPS the flush (retried on the next trigger). A PERMANENT rejection
 *    (e.g. the delivery window closed → 409) marks it `failed` and skips it — shown honestly, not
 *    retried forever.
 *  • Every mutation is persisted through the injected store, so an app kill mid-send loses nothing.
 *  • A retry reuses the item's `idempotencyKey`, so if the server actually persisted a message whose
 *    response was lost, the retry is de-duped server-side (never a double-send).
 */
export type SendOne = (item: OutboxItem) => Promise<ChatMessageDto>;

export interface FlushResult {
  /** Server rows for the items confirmed this flush (merge into the thread; dedup vs the WS echo). */
  confirmed: ChatMessageDto[];
  sent: number;
  /** Still-queued (will retry). */
  remaining: number;
  /** Permanently failed (surfaced, not retried). */
  failed: number;
  /** True when the flush drained all queued work without a transient stop. */
  ok: boolean;
}

interface OutboxDeps {
  nowIso?: () => string;
  genId?: () => string;
  cap?: number;
}

export class ChatOutbox {
  private items: OutboxItem[] = [];
  private loaded = false;

  constructor(
    private readonly orderId: string,
    private readonly store: OutboxStore,
    private readonly deps: OutboxDeps = {},
  ) {}

  /** Restore persisted items for this order (call once on mount — realises durable persistence). */
  async init(): Promise<void> {
    if (this.loaded) return;
    this.items = (await this.store.load()).filter((i) => i.orderId === this.orderId);
    this.loaded = true;
  }

  list(): readonly OutboxItem[] {
    return this.items;
  }
  pendingCount(): number {
    return this.items.filter((i) => i.status === 'queued').length;
  }
  hasWork(): boolean {
    return this.items.some((i) => i.status === 'queued');
  }

  /** Enqueue a composed message (persisted immediately) and return the tracked item. */
  async enqueue(body: string, idempotencyKey: string): Promise<OutboxItem> {
    const item: OutboxItem = {
      id: this.genId(),
      orderId: this.orderId,
      body,
      idempotencyKey,
      createdAt: this.now(),
      status: 'queued',
    };
    this.items = [...this.items, item];
    const cap = this.deps.cap ?? 500;
    if (this.items.length > cap) {
      // Evict TERMINAL (failed) items first — oldest first — so a still-queued (undelivered) message is
      // never silently dropped ahead of a permanently-failed one. Only if the queue is STILL over cap
      // after removing every failed item (a pathological 500+ undelivered backlog) do we drop the oldest.
      let excess = this.items.length - cap;
      const failedOldestFirst = this.items.filter((i) => i.status === 'failed').map((i) => i.id);
      const evict = new Set(failedOldestFirst.slice(0, excess));
      if (evict.size) this.items = this.items.filter((i) => !evict.has(i.id));
      excess = this.items.length - cap;
      if (excess > 0) this.items = this.items.slice(excess); // last resort
    }
    await this.persist();
    return item;
  }

  /**
   * Attempt to deliver queued items in order. Confirmed items leave the queue; a transient failure
   * stops (stays queued for the next trigger); a permanent failure is marked `failed` and skipped.
   * NEVER throws (mirrors LocationOutbox) and NEVER reports an item sent unless the server responded.
   */
  async flush(send: SendOne, isPermanent?: (err: unknown) => boolean): Promise<FlushResult> {
    const confirmed: ChatMessageDto[] = [];
    let stoppedTransient = false;

    for (const item of [...this.items]) {
      if (item.status !== 'queued') continue;
      try {
        const msg = await send(item);
        this.items = this.items.filter((i) => i.id !== item.id); // confirmed → leaves the queue
        confirmed.push(msg);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isPermanent?.(err)) {
          // Permanent (e.g. 409 chat_read_only): surface honestly, do not retry, keep draining others.
          this.items = this.items.map((i) => (i.id === item.id ? { ...i, status: 'failed', error: message } : i));
          continue;
        }
        // Transient (offline / 5xx): stays queued, stop here — the next trigger retries in order.
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
    return this.deps.genId ? this.deps.genId() : `local-${this.now()}-${Math.round(Math.random() * 1e9)}`;
  }
  private async persist(): Promise<void> {
    await this.store.save(this.items);
  }
}
