import type { ChatMessageDto, MessageListResult } from '@blue-bee/shared';
import { ChatController, type ChatSocketHandlers, type ChatSocketLike, type ChatState } from './chat-controller';

const flush = () => new Promise((r) => setImmediate(r));

function msg(over: Partial<ChatMessageDto> = {}): ChatMessageDto {
  return {
    id: 'm1',
    orderId: 'o1',
    threadId: 'o1',
    fromUserId: 'driver-user',
    toUserId: 'cust-user',
    body: 'hello',
    sentAt: '2026-07-01T12:00:00.000Z',
    readAt: null,
    ...over,
  };
}

function page(over: Partial<MessageListResult> = {}): MessageListResult {
  return { messages: [], nextCursor: null, hasMore: false, unreadCount: 0, open: true, ...over };
}

/** Harness: a queue of history pages + a captured fake chat socket per connect + a send log. */
function harness(pages: MessageListResult[], opts: { token?: string | null } = {}) {
  let i = 0;
  const connects: { token: string; handlers: ChatSocketHandlers; socket: ChatSocketLike & { disconnected: boolean } }[] = [];
  const states: ChatState[] = [];
  const sent: string[] = [];
  let markReadCalls = 0;

  const fetchHistory = jest.fn(async () => pages[Math.min(i++, pages.length - 1)]!);
  const fetchChannelToken = jest.fn(async () => (opts.token === undefined ? 'tok-1' : opts.token));
  const connect = jest.fn((token: string, handlers: ChatSocketHandlers): ChatSocketLike => {
    const socket = { disconnected: false, disconnect: jest.fn(() => { socket.disconnected = true; }) };
    connects.push({ token, handlers, socket });
    return socket;
  });
  const send = jest.fn(async (body: string) => {
    sent.push(body);
    return msg({ id: `sent-${sent.length}`, fromUserId: 'cust-user', toUserId: 'driver-user', body, sentAt: `2026-07-01T13:0${sent.length}:00.000Z` });
  });
  const markRead = jest.fn(async () => { markReadCalls += 1; });

  const controller = new ChatController({ fetchHistory, fetchChannelToken, connect, send, markRead, onState: (s) => states.push(s) });
  const last = () => states[states.length - 1]!;
  const current = () => connects[connects.length - 1]!;
  return { controller, fetchHistory, fetchChannelToken, connect, send, connects, states, sent, last, current, markReadCalls: () => markReadCalls };
}

describe('ChatController (REST-truth / WS-optimisation, Inc-18)', () => {
  it('loads persisted history (ascending) + open state, marks read, then connects the live socket', async () => {
    const h = harness([page({ messages: [msg({ id: 'm2', sentAt: '2026-07-01T12:02:00.000Z' }), msg({ id: 'm1', sentAt: '2026-07-01T12:00:00.000Z' })], unreadCount: 1, open: true })]);
    await h.controller.start();
    await flush();
    // Newest-first from the server → sorted ascending for display (oldest first).
    expect(h.last().messages.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(h.last().open).toBe(true);
    expect(h.last().phase).toBe('ready');
    expect(h.markReadCalls()).toBeGreaterThanOrEqual(1);
    expect(h.last().unreadCount).toBe(0);
    expect(h.connect).toHaveBeenCalledWith('tok-1', expect.anything());
  });

  it('a live chat:message appends and de-dupes by id (WS echo of a POST is not doubled)', async () => {
    const h = harness([page({ messages: [] })]);
    await h.controller.start();
    await flush();
    h.current().handlers.onConnect();
    expect(h.last().live).toBe(true);
    const incoming = msg({ id: 'live-1', body: 'on my way' });
    h.current().handlers.onChatMessage(incoming);
    expect(h.last().messages.map((m) => m.id)).toEqual(['live-1']);
    // Same id again (echo) → still one row, not duplicated.
    h.current().handlers.onChatMessage({ ...incoming, readAt: '2026-07-01T12:05:00.000Z' });
    expect(h.last().messages).toHaveLength(1);
    expect(h.last().messages[0]!.readAt).toBe('2026-07-01T12:05:00.000Z'); // last write wins
  });

  it('send() posts and merges the returned row (no duplicate when the socket later echoes the same id)', async () => {
    const h = harness([page({ messages: [] })]);
    await h.controller.start();
    await flush();
    await h.controller.send('  hi driver  ');
    expect(h.sent).toEqual(['hi driver']); // trimmed
    expect(h.last().messages.map((m) => m.body)).toEqual(['hi driver']);
    // The WS echo of the same message id must not add a second bubble.
    h.current().handlers.onChatMessage(msg({ id: 'sent-1', fromUserId: 'cust-user', body: 'hi driver' }));
    expect(h.last().messages).toHaveLength(1);
  });

  it('read-only (open=false, no channel token) → never opens a socket and send() is a no-op', async () => {
    const h = harness([page({ open: false })], { token: null });
    await h.controller.start();
    await flush();
    expect(h.last().open).toBe(false);
    expect(h.connect).not.toHaveBeenCalled();
    await h.controller.send('should not send');
    expect(h.sent).toEqual([]);
  });

  it('loadOlder pages backward into older history and preserves ascending order', async () => {
    const h = harness([
      page({ messages: [msg({ id: 'm3', sentAt: '2026-07-01T12:03:00.000Z' })], hasMore: true, nextCursor: 'm3' }),
      page({ messages: [msg({ id: 'm1', sentAt: '2026-07-01T12:01:00.000Z' }), msg({ id: 'm2', sentAt: '2026-07-01T12:02:00.000Z' })], hasMore: false, nextCursor: null }),
    ]);
    await h.controller.start();
    await flush();
    expect(h.last().hasMore).toBe(true);
    await h.controller.loadOlder();
    await flush();
    expect(h.last().messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(h.last().hasMore).toBe(false);
  });
});
