import { CommsChannel, NotificationStatus } from '@blue-bee/shared';
import { NotificationProcessor } from './notification-processor.service';
import type { NotificationsConfig } from '../config/notifications.config';
import type { NotificationTransport, TransportRegistry } from './transports/notification-transport';

/** A minimal config for the processor (only retry.* is read by attemptSend). */
function cfg(over: Partial<NotificationsConfig['retry']> = {}): NotificationsConfig {
  return {
    appName: 'Blue Bee',
    matrix: {},
    urgentEventTypes: new Set(),
    quietHours: { policy: 'defer', defaultTimezone: 'America/Toronto' },
    retry: { maxAttempts: 3, backoffMs: 1000, sendTimeoutMs: 1000, scanIntervalMs: 0, kickOnDispatch: false, ...over },
    email: { sandbox: true, apiKey: null, fromEmail: 'x@y.z', fromName: 'Blue Bee' },
    push: { transport: 'console', accessToken: null },
  };
}

interface FakeRow {
  id: string;
  orgId: string;
  status: NotificationStatus;
  channel: CommsChannel;
  payload: unknown;
  attempts: number;
  scheduledFor: Date | null;
  sentAt: Date | null;
  providerMessageId: string | null;
  lastError: string | null;
}

/**
 * A faithful in-memory Notification store: updateMany honors the claim's status/scheduled_for WHERE
 * (so the atomic-claim semantics are exercised) and applies {increment} + scalar data to the row.
 */
function fakeStore(initial: Partial<FakeRow> & Pick<FakeRow, 'id'>) {
  const row: FakeRow = {
    orgId: 'o1',
    status: NotificationStatus.PENDING,
    channel: CommsChannel.SMS,
    payload: { recipients: ['+1555'], body: 'hi' },
    attempts: 0,
    scheduledFor: null,
    sentAt: null,
    providerMessageId: null,
    lastError: null,
    ...initial,
  };
  const prisma = {
    notification: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => (where.id === row.id ? { ...row } : null)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: jest.fn(async ({ where, data }: { where: any; data: any }) => {
        if (where.id !== row.id) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(row.status)) return { count: 0 }; // claim status gate
        if (where.OR) {
          const due = row.scheduledFor == null || row.scheduledFor.getTime() <= Date.now();
          if (!due) return { count: 0 }; // claim due gate
        }
        if (data.attempts && typeof data.attempts === 'object' && 'increment' in data.attempts) {
          row.attempts += data.attempts.increment as number;
        } else if (typeof data.attempts === 'number') {
          row.attempts = data.attempts;
        }
        if ('status' in data) row.status = data.status;
        if ('scheduledFor' in data) row.scheduledFor = data.scheduledFor;
        if ('sentAt' in data) row.sentAt = data.sentAt;
        if ('providerMessageId' in data) row.providerMessageId = data.providerMessageId;
        if ('lastError' in data) row.lastError = data.lastError;
        return { count: 1 };
      }),
      findMany: jest.fn(async () => [{ id: row.id }]),
    },
  };
  return { prisma, row };
}

function makeProcessor(store: ReturnType<typeof fakeStore>, transport: NotificationTransport, config = cfg()) {
  const registry: TransportRegistry = new Map([[transport.channel, transport]]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NotificationProcessor(store.prisma as any, config, registry);
}

const okTransport = (id = 'sid-1'): NotificationTransport => ({
  channel: CommsChannel.SMS,
  name: 'sms:fake',
  send: jest.fn(async () => ({ providerMessageId: id })),
});
const throwTransport = (): NotificationTransport => ({
  channel: CommsChannel.SMS,
  name: 'sms:fake',
  send: jest.fn(async () => {
    throw new Error('provider down');
  }),
});

describe('NotificationProcessor.attemptSend (Increment 8)', () => {
  it('claims + sends a due PENDING row → SENT with provider id (attempt 1)', async () => {
    const store = fakeStore({ id: 'n1' });
    const t = okTransport('SMxyz');
    await makeProcessor(store, t).attemptSend('n1');
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(store.row.status).toBe(NotificationStatus.SENT);
    expect(store.row.attempts).toBe(1);
    expect(store.row.providerMessageId).toBe('SMxyz');
    expect(store.row.sentAt).not.toBeNull();
  });

  it('skips a terminal row (claim matches nothing, no transport call)', async () => {
    const store = fakeStore({ id: 'n1', status: NotificationStatus.SENT });
    const t = okTransport();
    await makeProcessor(store, t).attemptSend('n1');
    expect(t.send).not.toHaveBeenCalled();
    expect(store.row.status).toBe(NotificationStatus.SENT);
  });

  it('skips a not-yet-due row (scheduled in the future → claim matches nothing)', async () => {
    const store = fakeStore({ id: 'n1', status: NotificationStatus.RETRYING, scheduledFor: new Date(Date.now() + 60_000) });
    const t = okTransport();
    await makeProcessor(store, t).attemptSend('n1');
    expect(t.send).not.toHaveBeenCalled();
  });

  it('empty recipients → SUPPRESSED, transport not called', async () => {
    const store = fakeStore({ id: 'n1', payload: { recipients: [], body: 'hi' } });
    const t = okTransport();
    await makeProcessor(store, t).attemptSend('n1');
    expect(t.send).not.toHaveBeenCalled();
    expect(store.row.status).toBe(NotificationStatus.SUPPRESSED);
  });

  it('transport failure with attempts < max → RETRYING with backoff (never throws)', async () => {
    const store = fakeStore({ id: 'n1' });
    const t = throwTransport();
    await expect(makeProcessor(store, t, cfg({ maxAttempts: 3, backoffMs: 1000 })).attemptSend('n1')).resolves.toBeUndefined();
    expect(store.row.status).toBe(NotificationStatus.RETRYING);
    expect(store.row.attempts).toBe(1);
    expect((store.row.scheduledFor as Date).getTime()).toBeGreaterThan(Date.now());
    expect(store.row.lastError).toContain('provider down');
  });

  it('transport failure reaching max attempts → FAILED with last_error', async () => {
    const store = fakeStore({ id: 'n1', attempts: 1 }); // claim bumps to 2 == maxAttempts
    const t = throwTransport();
    await makeProcessor(store, t, cfg({ maxAttempts: 2 })).attemptSend('n1');
    expect(store.row.status).toBe(NotificationStatus.FAILED);
    expect(store.row.attempts).toBe(2);
    expect(store.row.lastError).toContain('provider down');
  });

  it('a hung transport is bounded by the send timeout → retry, never hangs', async () => {
    const store = fakeStore({ id: 'n1' });
    const hung: NotificationTransport = {
      channel: CommsChannel.SMS,
      name: 'sms:hung',
      // resolves far past the send timeout, via an UNREF'd timer so it never blocks Jest teardown
      send: () =>
        new Promise((resolve) => {
          const tm = setTimeout(() => resolve({}), 10_000);
          tm.unref?.();
        }),
    };
    await makeProcessor(store, hung, cfg({ sendTimeoutMs: 20, maxAttempts: 3 })).attemptSend('n1');
    expect(store.row.status).toBe(NotificationStatus.RETRYING);
    expect(store.row.lastError).toContain('timed out');
  });

  it('two concurrent attemptSend on the same row → exactly ONE transport send (atomic claim)', async () => {
    const store = fakeStore({ id: 'n1' });
    const t = okTransport('once');
    const proc = makeProcessor(store, t);
    await Promise.all([proc.attemptSend('n1'), proc.attemptSend('n1')]);
    expect(t.send).toHaveBeenCalledTimes(1); // the loser's claim matched 0 rows (already RETRYING+leased/SENT)
    expect(store.row.status).toBe(NotificationStatus.SENT);
  });
});
