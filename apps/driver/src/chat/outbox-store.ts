/**
 * Chat outbox persistence port (Increment 18). The driver app has NO general mutation queue
 * (stop actions call the API directly); the ONLY offline-queue seam is `LocationOutbox`, which is
 * in-memory and explicitly defers cross-relaunch persistence. A chat message composed offline MUST
 * survive an app kill, so the chat outbox persists through this port. Kept as a pure interface (+ an
 * in-memory impl for tests) so the outbox logic is unit-tested headlessly; the real durable impl
 * (expo-file-system) lives in `file-outbox-store.ts` and is wired only in the app.
 */

/** One locally-composed message awaiting confirmed delivery. Never "sent": a sent item LEAVES the outbox. */
export interface OutboxItem {
  /** Local id (distinct from the server message id assigned on confirmation). */
  id: string;
  orderId: string;
  body: string;
  /** Stable per-message key so a retry of the SAME composed message is de-duped server-side. */
  idempotencyKey: string;
  /** ISO-8601 compose time (ordering + display). */
  createdAt: string;
  /** `queued` = will be (re)tried; `failed` = a permanent rejection (e.g. window closed) — shown, not retried. */
  status: 'queued' | 'failed';
  /** Last delivery error (for honest UI: "couldn't send"). */
  error?: string;
}

export interface OutboxStore {
  load(): Promise<OutboxItem[]>;
  save(items: OutboxItem[]): Promise<void>;
}

/** In-memory store for tests + the integration proof (no native import). Records save() calls. */
export class MemoryOutboxStore implements OutboxStore {
  private data: OutboxItem[];
  saveCount = 0;

  constructor(seed: OutboxItem[] = []) {
    this.data = seed.map((x) => ({ ...x }));
  }

  async load(): Promise<OutboxItem[]> {
    return this.data.map((x) => ({ ...x }));
  }

  async save(items: OutboxItem[]): Promise<void> {
    this.saveCount += 1;
    this.data = items.map((x) => ({ ...x }));
  }

  /** Test helper — what's durably persisted right now (survives a simulated relaunch). */
  snapshot(): OutboxItem[] {
    return this.data.map((x) => ({ ...x }));
  }
}
