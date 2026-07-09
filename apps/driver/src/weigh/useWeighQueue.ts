import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { WeighPoint, type WeightCaptureResult } from '@blue-bee/shared';
import { ApiError } from '../api/problem';
import type { ApiClient } from '../api/client';
import { WeighOutbox, type EnqueueWeighInput } from './weigh-outbox';
import { FileWeighOutboxStore } from './file-weigh-outbox-store';

/** How often to re-attempt the durable queue while mounted (no NetInfo in the driver app). */
const RETRY_INTERVAL_MS = 15_000;

/** A definitive client-side rejection (4xx except auth) is permanent — don't retry it forever. */
function isPermanent(err: unknown): boolean {
  return err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401;
}

export type ApproveOutcome =
  | { outcome: 'synced'; result: WeightCaptureResult }
  | { outcome: 'queued' }
  | { outcome: 'failed'; error: string };

export interface UseWeighQueue {
  /** Number of approvals still queued (offline / awaiting sync). */
  pending: number;
  /** A flush is in flight. */
  syncing: boolean;
  /**
   * Approve a weigh: persist it (survives an app kill) then try to send. Returns `synced` when the server
   * confirmed it now, `queued` when there's no signal (it will sync on the next trigger), or `failed` on a
   * permanent (4xx) rejection. Re-weigh = a fresh idempotency key = a new immutable capture.
   */
  approve(input: EnqueueWeighInput): Promise<ApproveOutcome>;
  /** Force a queue drain (e.g. a manual "retry now"). */
  flushNow(): void;
}

/**
 * Offline-first driver weigh queue (Inc-23 P2). Approvals flow through the durable `WeighOutbox`
 * (persisted via expo-file-system), so a weigh approved with no signal is queued honestly and synced
 * later. Retry triggers mirror the chat outbox: app foreground + a bounded interval (no NetInfo in the
 * driver app). Stop status stays authoritative over raw GPS — this only syncs the append-only capture.
 */
export function useWeighQueue(client: ApiClient): UseWeighQueue {
  const outboxRef = useRef<WeighOutbox | null>(null);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const send = useCallback(
    (item: Parameters<Parameters<WeighOutbox['flush']>[0]>[0]) =>
      client.weighLoad(item.stopId, { weightKg: item.weightKg, weighPoint: item.weighPoint as WeighPoint, source: item.source, note: item.note }, item.idempotencyKey),
    [client],
  );

  const drain = useCallback(async () => {
    const outbox = outboxRef.current;
    if (!outbox || !outbox.hasWork()) return;
    setSyncing(true);
    try {
      await outbox.flush(send, isPermanent);
    } finally {
      setPending(outbox.pendingCount());
      setSyncing(false);
    }
  }, [send]);

  useEffect(() => {
    const outbox = new WeighOutbox(new FileWeighOutboxStore());
    outboxRef.current = outbox;
    void (async () => {
      await outbox.init();
      setPending(outbox.pendingCount());
      await drain(); // sync anything left from a previous (offline) session
    })();

    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void drain();
    });
    const timer = setInterval(() => void drain(), RETRY_INTERVAL_MS);

    return () => {
      appSub.remove();
      clearInterval(timer);
      outboxRef.current = null;
    };
  }, [drain]);

  const approve = useCallback(
    async (input: EnqueueWeighInput): Promise<ApproveOutcome> => {
      const outbox = outboxRef.current;
      if (!outbox) return { outcome: 'queued' };
      const key = `weigh-${input.stopId}-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const item = await outbox.enqueue(input, key);
      setPending(outbox.pendingCount());
      setSyncing(true);
      try {
        const res = await outbox.flush(send, isPermanent);
        const stillQueued = outbox.list().find((i) => i.id === item.id);
        // This item is the newest enqueued, so it confirms LAST (FIFO) — its result is the final confirmed.
        const result = res.confirmed[res.confirmed.length - 1];
        if (!stillQueued && result) return { outcome: 'synced', result };
        if (stillQueued?.status === 'failed') return { outcome: 'failed', error: stillQueued.error ?? 'rejected' };
        return { outcome: 'queued' };
      } finally {
        setPending(outbox.pendingCount());
        setSyncing(false);
      }
    },
    [send],
  );

  const flushNow = useCallback(() => void drain(), [drain]);

  return { pending, syncing, approve, flushNow };
}
