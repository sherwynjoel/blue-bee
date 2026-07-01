import type { ChatMessageDto, MessageListResult } from '@blue-bee/shared';
import type { ChatOutbox, SendOne } from './chat-outbox';
import type { OutboxItem } from './outbox-store';

/**
 * Driver order-chat state machine (Increment 18) — framework-agnostic (unit-tested headlessly),
 * offline-first. Like the customer controller it treats REST history as source of truth + the WS as
 * an optimisation, but the SEND path goes through the durable `ChatOutbox`: a message is enqueued +
 * persisted, then flushed; it shows QUEUED until the server confirms it, then becomes a real sent
 * bubble. Nothing is ever shown "sent" before the server responds (offline honesty — 6-lens #5).
 */

export type DriverChatPhase = 'loading' | 'ready' | 'error';

export interface DriverChatState {
  phase: DriverChatPhase;
  /** Confirmed server messages, ascending by (sentAt, id). */
  messages: ChatMessageDto[];
  /** Locally-queued/failed sends not yet confirmed (rendered with a queued/failed indicator). */
  pending: OutboxItem[];
  open: boolean;
  live: boolean;
  /** A flush is in flight (a subtle "syncing" affordance). */
  syncing: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  error: string | null;
}

export interface DriverChatSocketHandlers {
  onConnect(): void;
  onChatMessage(ev: ChatMessageDto): void;
  onConnectError(err: { message?: string; data?: { code?: string } }): void;
  onDisconnect(reason: string): void;
}
export interface DriverChatSocketLike {
  disconnect(): void;
}

export interface DriverChatDeps {
  fetchHistory(cursor?: string): Promise<MessageListResult>;
  fetchChannelToken(): Promise<string | null>;
  connect(channelToken: string, handlers: DriverChatSocketHandlers): DriverChatSocketLike;
  /** The durable send-queue (already `init()`-ed by the caller, or init'd in start()). */
  outbox: ChatOutbox;
  /** POST one queued item (with its idempotency key) — used by outbox.flush. */
  sendOne: SendOne;
  /** Classify a delivery error: true ⇒ permanent (don't retry, mark failed). */
  isPermanent(err: unknown): boolean;
  /** A fresh idempotency key for a newly-composed message. */
  genIdempotencyKey(): string;
  markRead(): Promise<void>;
  onState(state: DriverChatState): void;
}

export const INITIAL_DRIVER_CHAT_STATE: DriverChatState = {
  phase: 'loading',
  messages: [],
  pending: [],
  open: false,
  live: false,
  syncing: false,
  hasMore: false,
  nextCursor: null,
  error: null,
};

function ascending(a: ChatMessageDto, b: ChatMessageDto): number {
  if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class DriverChatController {
  private state: DriverChatState = { ...INITIAL_DRIVER_CHAT_STATE };
  private socket: DriverChatSocketLike | null = null;
  private stopped = false;

  constructor(private readonly deps: DriverChatDeps) {}

  getState(): DriverChatState {
    return this.state;
  }

  private patch(p: Partial<DriverChatState>): void {
    this.state = { ...this.state, ...p };
    if (!this.stopped) this.deps.onState(this.state);
  }

  private mergeServer(msg: ChatMessageDto): void {
    const idx = this.state.messages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      const next = this.state.messages.slice();
      next[idx] = msg;
      this.patch({ messages: next });
    } else {
      this.patch({ messages: [...this.state.messages, msg].sort(ascending) });
    }
  }

  private syncPending(): void {
    this.patch({ pending: [...this.deps.outbox.list()] });
  }

  /** Load persisted outbox + REST history, mark read, open the socket, then sync any leftover sends. */
  async start(): Promise<void> {
    try {
      await this.deps.outbox.init();
      this.syncPending();
      await this.fetchPage();
      if (this.stopped) return;
      await this.safeMarkRead();
      await this.openLiveChannel();
      await this.flush(); // drain anything queued from a prior offline session
    } catch (e) {
      if (!this.stopped) this.patch({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  async loadOlder(): Promise<void> {
    if (!this.state.hasMore || !this.state.nextCursor || this.stopped) return;
    await this.fetchPage(this.state.nextCursor);
  }

  /**
   * Compose + queue a message. Enqueued & persisted first (survives a kill), THEN flushed — so the
   * bubble shows queued until the server confirms it. No-op when read-only (composer is disabled too).
   */
  async send(body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed || !this.state.open || this.stopped) return;
    await this.deps.outbox.enqueue(trimmed, this.deps.genIdempotencyKey());
    this.syncPending();
    await this.flush();
  }

  /** Drive the durable queue (called on send, on (re)connect, and by the hook's retry trigger). */
  async flush(): Promise<void> {
    if (this.stopped || !this.deps.outbox.hasWork()) return;
    this.patch({ syncing: true });
    try {
      const res = await this.deps.outbox.flush(this.deps.sendOne, this.deps.isPermanent);
      if (this.stopped) return;
      for (const msg of res.confirmed) this.mergeServer(msg);
      this.syncPending();
    } finally {
      if (!this.stopped) this.patch({ syncing: false });
    }
  }

  stop(): void {
    this.stopped = true;
    this.disconnectSocket();
  }

  // ── internals ──

  private async fetchPage(cursor?: string): Promise<void> {
    const page = await this.deps.fetchHistory(cursor);
    if (this.stopped) return;
    const byId = new Map(this.state.messages.map((m) => [m.id, m]));
    for (const m of page.messages) byId.set(m.id, m);
    this.patch({
      phase: 'ready',
      messages: [...byId.values()].sort(ascending),
      open: page.open,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      error: null,
    });
  }

  private async openLiveChannel(): Promise<void> {
    const token = await this.safeFetchToken();
    if (this.stopped || !token) return;
    this.disconnectSocket();
    this.socket = this.deps.connect(token, {
      onConnect: () => {
        this.patch({ live: true });
        void this.flush(); // reconnected → try to drain the queue
      },
      onChatMessage: (ev) => {
        this.mergeServer(ev);
        void this.safeMarkRead();
      },
      onConnectError: () => this.patch({ live: false }),
      onDisconnect: () => this.patch({ live: false }),
    });
  }

  private async safeFetchToken(): Promise<string | null> {
    try {
      return await this.deps.fetchChannelToken();
    } catch {
      return null;
    }
  }

  private async safeMarkRead(): Promise<void> {
    try {
      await this.deps.markRead();
    } catch {
      // non-fatal
    }
  }

  private disconnectSocket(): void {
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    if (!this.stopped) this.patch({ live: false });
  }
}
