import type { ChatMessageDto, MessageListResult } from '@blue-bee/shared';

/**
 * Order-chat state machine (Increment 18) — framework-agnostic so it's unit-tested headlessly.
 *
 * THE CONTRACT IT ENFORCES (mirrors the tracking controller's REST-truth / WS-optimisation model):
 *  • REST is the SOURCE OF TRUTH. We paint from `GET /orders/:id/messages` (persisted history),
 *    then a live socket only REFINES it — a dropped socket never loses a message (it's still in the
 *    persisted thread and re-appears on the next fetch). The `chat:message` WS event is an optimisation.
 *  • DEDUP BY ID. A message can arrive twice — once as the POST response (sender) and once as the WS
 *    echo — so every merge is keyed by message id (last write wins, e.g. a later read_at). Messages
 *    are kept ASCENDING by (sentAt, id) for display (oldest → newest, newest at the bottom).
 *  • READ-ONLY GATE. `open` comes from the server (the order's active-delivery window). When false the
 *    composer is disabled and send() is a no-op — the server would reject the POST 409 anyway; this
 *    just avoids a doomed round-trip. `open` is refreshed on every history fetch + socket (re)connect.
 *  • MARK-READ. On load and on each live inbound message while the thread is being viewed, the caller's
 *    unread is cleared server-side; the local unreadCount tracks that so the order badge stays honest.
 */

export type ChatPhase = 'loading' | 'ready' | 'error';

export interface ChatState {
  phase: ChatPhase;
  /** Ascending by (sentAt, id): oldest first, newest last (rendered newest at the bottom). */
  messages: ChatMessageDto[];
  /** Composer enabled — the order is in its active delivery window. */
  open: boolean;
  /** Unread inbound messages for the caller (drives the order badge; 0 while actively viewing). */
  unreadCount: number;
  /** More (older) history available to page backward into. */
  hasMore: boolean;
  nextCursor: string | null;
  /** A live socket is connected (messages arrive in real time). */
  live: boolean;
  /** A send is in flight (disables the send button). */
  sending: boolean;
  error: string | null;
}

export interface ChatSocketHandlers {
  onConnect(): void;
  onChatMessage(ev: ChatMessageDto): void;
  onConnectError(err: { message?: string; data?: { code?: string } }): void;
  onDisconnect(reason: string): void;
}

export interface ChatSocketLike {
  disconnect(): void;
}

export interface ChatDeps {
  /** REST source of truth — `GET /v1/orders/:id/messages` (cursor = older page). */
  fetchHistory(cursor?: string): Promise<MessageListResult>;
  /** Mint the live channel token (null ⇒ read-only, no live socket). */
  fetchChannelToken(): Promise<string | null>;
  /** Open the `/live/vehicle` socket for live chat; returns a handle to disconnect. */
  connect(channelToken: string, handlers: ChatSocketHandlers): ChatSocketLike;
  /** Persist a message (POST) — the returned row is merged (dedup by id vs the WS echo). */
  send(body: string): Promise<ChatMessageDto>;
  /** Clear the caller's unread server-side. */
  markRead(): Promise<void>;
  /** Emit the new state to the subscriber (the React hook). */
  onState(state: ChatState): void;
}

export const INITIAL_CHAT_STATE: ChatState = {
  phase: 'loading',
  messages: [],
  open: false,
  unreadCount: 0,
  hasMore: false,
  nextCursor: null,
  live: false,
  sending: false,
  error: null,
};

/** Ascending sort key so a live insert lands in the right place regardless of arrival order. */
function ascending(a: ChatMessageDto, b: ChatMessageDto): number {
  if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class ChatController {
  private state: ChatState = { ...INITIAL_CHAT_STATE };
  private socket: ChatSocketLike | null = null;
  private stopped = false;

  constructor(private readonly deps: ChatDeps) {}

  getState(): ChatState {
    return this.state;
  }

  private patch(p: Partial<ChatState>): void {
    this.state = { ...this.state, ...p };
    if (!this.stopped) this.deps.onState(this.state);
  }

  /**
   * Merge one message by id (dedup the POST-response vs WS-echo double-delivery), keeping the list
   * sorted ascending. Returns whether the message was NEW (not previously present).
   */
  private merge(msg: ChatMessageDto): boolean {
    const idx = this.state.messages.findIndex((m) => m.id === msg.id);
    if (idx >= 0) {
      const next = this.state.messages.slice();
      next[idx] = msg; // last write wins (e.g. read_at flipped)
      this.patch({ messages: next });
      return false;
    }
    this.patch({ messages: [...this.state.messages, msg].sort(ascending) });
    return true;
  }

  /** Begin: load persisted history (truth) + mark read, then open a live socket if one is available. */
  async start(): Promise<void> {
    try {
      const page = await this.fetchPage();
      if (this.stopped || !page) return;
      // Any inbound history is now being viewed → clear unread server-side + locally.
      await this.safeMarkRead();
      await this.openLiveChannel();
    } catch (e) {
      if (!this.stopped) this.patch({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Page backward into older history (scroll-up-to-load). No-op when there's nothing older. */
  async loadOlder(): Promise<void> {
    if (!this.state.hasMore || !this.state.nextCursor || this.stopped) return;
    await this.fetchPage(this.state.nextCursor);
  }

  /** Send a message. No-op when read-only (the server would 409 anyway). Merges the persisted row. */
  async send(body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed || !this.state.open || this.state.sending || this.stopped) return;
    this.patch({ sending: true, error: null });
    try {
      const msg = await this.deps.send(trimmed);
      if (!this.stopped) this.merge(msg);
    } catch (e) {
      if (!this.stopped) this.patch({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      if (!this.stopped) this.patch({ sending: false });
    }
  }

  stop(): void {
    this.stopped = true;
    this.disconnectSocket();
  }

  // ── internals ──

  /** Fetch a history page (initial or older) and fold it into state. Returns the page or null. */
  private async fetchPage(cursor?: string): Promise<MessageListResult | null> {
    const page = await this.deps.fetchHistory(cursor);
    if (this.stopped) return null;
    // Server returns newest-first; merge each (ascending sort handles ordering + dedup).
    const byId = new Map(this.state.messages.map((m) => [m.id, m]));
    for (const m of page.messages) byId.set(m.id, m);
    this.patch({
      phase: 'ready',
      messages: [...byId.values()].sort(ascending),
      open: page.open,
      unreadCount: page.unreadCount,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      error: null,
    });
    return page;
  }

  private async openLiveChannel(): Promise<void> {
    const token = await this.safeFetchToken();
    if (this.stopped || !token) return; // read-only window → REST only, no live socket
    this.disconnectSocket();
    this.socket = this.deps.connect(token, {
      onConnect: () => this.patch({ live: true }),
      onChatMessage: (ev) => {
        const isNew = this.merge(ev);
        // A freshly-arrived inbound message while viewing → keep the unread badge honest.
        if (isNew) void this.safeMarkRead();
      },
      onConnectError: () => this.patch({ live: false }),
      onDisconnect: () => this.patch({ live: false }),
    });
  }

  private async safeFetchToken(): Promise<string | null> {
    try {
      return await this.deps.fetchChannelToken();
    } catch {
      return null; // no live socket; REST history still works
    }
  }

  private async safeMarkRead(): Promise<void> {
    try {
      await this.deps.markRead();
      if (!this.stopped) this.patch({ unreadCount: 0 });
    } catch {
      // non-fatal — the badge will correct on the next fetch
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
