import type { ChatMessageDto, MessageListResult } from '@blue-bee/shared';
import { DriverChatController, type DriverChatSocketHandlers, type DriverChatSocketLike, type DriverChatState } from './chat-controller';
import { ChatOutbox } from './chat-outbox';
import { MemoryOutboxStore, type OutboxItem } from './outbox-store';

const flush = () => new Promise((r) => setImmediate(r));

function serverMsg(over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return { id: 'srv-1', orderId: 'o1', threadId: 'o1', fromUserId: 'driver-user', toUserId: 'cust-user', body: 'hi', sentAt: '2026-07-01T12:00:00.000Z', readAt: null, ...over };
}
function page(over: Partial<MessageListResult> = {}): MessageListResult {
  return { messages: [], nextCursor: null, hasMore: false, unreadCount: 0, open: true, ...over };
}

function harness(pages: MessageListResult[], opts: { token?: string | null } = {}) {
  let i = 0;
  let idemN = 0;
  const store = new MemoryOutboxStore();
  const outbox = new ChatOutbox('o1', store, { genId: () => `local-${++idemN}`, nowIso: () => `2026-07-01T12:0${idemN}:00.000Z` });
  const states: DriverChatState[] = [];
  const connects: { token: string; handlers: DriverChatSocketHandlers; socket: DriverChatSocketLike }[] = [];

  const fetchHistory = jest.fn(async () => pages[Math.min(i++, pages.length - 1)]!);
  const fetchChannelToken = jest.fn(async () => (opts.token === undefined ? 'tok-1' : opts.token));
  const connect = jest.fn((token: string, handlers: DriverChatSocketHandlers): DriverChatSocketLike => {
    const socket = { disconnect: jest.fn() };
    connects.push({ token, handlers, socket });
    return socket;
  });
  const sendOne = jest.fn(async (item: OutboxItem) => serverMsg({ id: `srv-${item.id}`, body: item.body, fromUserId: 'driver-user' }));
  const markRead = jest.fn(async () => undefined);

  const controller = new DriverChatController({
    fetchHistory,
    fetchChannelToken,
    connect,
    outbox,
    sendOne,
    isPermanent: () => false,
    genIdempotencyKey: () => `idem-${++idemN}`,
    markRead,
    onState: (s) => states.push(s),
  });
  const last = () => states[states.length - 1]!;
  const current = () => connects[connects.length - 1]!;
  return { controller, sendOne, connect, connects, states, last, current, store };
}

describe('DriverChatController (offline-first, Inc-18)', () => {
  it('loads history + open state, marks read, and connects the live socket', async () => {
    const h = harness([page({ messages: [serverMsg({ id: 'm1' })], open: true })]);
    await h.controller.start();
    await flush();
    expect(h.last().messages.map((m) => m.id)).toEqual(['m1']);
    expect(h.last().open).toBe(true);
    expect(h.connect).toHaveBeenCalledWith('tok-1', expect.anything());
  });

  it('send() enqueues then flushes, merging the confirmed server message (pending cleared)', async () => {
    const h = harness([page({ open: true })]);
    await h.controller.start();
    await flush();
    await h.controller.send('  on my way  ');
    await flush();
    expect(h.sendOne).toHaveBeenCalledTimes(1);
    expect(h.sendOne.mock.calls[0]![0].body).toBe('on my way'); // trimmed
    expect(h.last().messages.map((m) => m.body)).toEqual(['on my way']);
    expect(h.last().pending).toHaveLength(0);
  });

  it('OFFLINE: a failed send stays queued (honest), then a reconnect flush syncs it', async () => {
    const h = harness([page({ open: true })]);
    await h.controller.start();
    await flush();
    // First send fails (offline) — the message must show queued, never sent.
    h.sendOne.mockRejectedValueOnce(new Error('network down'));
    await h.controller.send('are you home?');
    await flush();
    expect(h.last().pending).toHaveLength(1);
    expect(h.last().pending[0]!.status).toBe('queued');
    expect(h.last().messages).toHaveLength(0); // NOT shown as a delivered message
    expect(h.store.snapshot()).toHaveLength(1); // durably persisted

    // Reconnect → controller flushes the queue → the message syncs and becomes a real bubble.
    h.current().handlers.onConnect();
    await flush();
    expect(h.last().messages.map((m) => m.body)).toEqual(['are you home?']);
    expect(h.last().pending).toHaveLength(0);
  });

  it('read-only (open=false) → send() is a no-op (composer would be disabled)', async () => {
    const h = harness([page({ open: false })], { token: null });
    await h.controller.start();
    await flush();
    expect(h.last().open).toBe(false);
    await h.controller.send('nope');
    await flush();
    expect(h.sendOne).not.toHaveBeenCalled();
    expect(h.last().pending).toHaveLength(0);
  });
});
