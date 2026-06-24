import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CommsChannel, NotificationStatus } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from '../config/notifications.config';
import { NOTIFICATION_TRANSPORTS, type OutgoingMessage, type TransportRegistry } from './transports/notification-transport';

/** The rendered content the engine persists on the row (Notification.payload). */
interface StoredPayload {
  recipients?: string[];
  subject?: string;
  title?: string;
  body?: string;
  eventType?: string;
}

/** Extra hold (ms) added to the send timeout when leasing a row, so a crashed sender's row becomes
 *  due again for another worker only AFTER the in-flight send could not still be running. */
const LEASE_SLACK_MS = 5_000;

/**
 * The outbox processor (Increment 8, §8.5) — performs ONE transport attempt per call and drives the
 * status lifecycle PENDING/RETRYING → SENT | RETRYING(+scheduled) | FAILED. Bounded retry with
 * linear backoff (`NOTIF_RETRY_BACKOFF_MS × attempt`); a per-attempt timeout (`NOTIF_SEND_TIMEOUT_MS`)
 * means a hung provider can never stall the worker. Per-channel isolation: each row is its own
 * attempt, so SMS failing never blocks email/push for the same event.
 *
 * Sending happens OFF the ingest request thread — never inline — so transport latency can never slow
 * `POST /locations:batch`. Two drivers: (1) a fire-and-forget kick from the dispatch path
 * (`NOTIF_KICK_ON_DISPATCH`) for prompt delivery, and (2) a background scan (`NOTIF_RETRY_SCAN_MS`,
 * 0 ⇒ disabled) that drains due PENDING/RETRYING rows (fresh, retry-backoff, and quiet-hours-deferred).
 *
 * CONCURRENCY-SAFE (no double-send across workers): `attemptSend` ATOMICALLY CLAIMS a row before
 * sending — a single conditional `updateMany` flips a due PENDING/RETRYING row to RETRYING and leases
 * `scheduled_for` into the future. Postgres row-locks the UPDATE, so a competing claim re-evaluates
 * its WHERE against the leased row and matches zero rows. Exactly one worker sends.
 */
@Injectable()
export class NotificationProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
    @Inject(NOTIFICATION_TRANSPORTS) private readonly transports: TransportRegistry,
  ) {}

  onModuleInit(): void {
    const ms = this.config.retry.scanIntervalMs;
    if (ms > 0) {
      this.timer = setInterval(() => void this.drainDue(), ms);
      this.timer.unref?.(); // never keep the process alive just for the drain
      this.logger.log(`notification retry-drain scan every ${ms}ms`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Attempt to deliver ONE notification row. NEVER THROWS (every path is wrapped) so a single row can
   * never abort a drain batch or reach the ingest path. Atomically claims the row first (so two
   * workers can't double-send), then sends and finalizes the status.
   */
  async attemptSend(notificationId: string): Promise<void> {
    try {
      const nowMs = Date.now();
      const leaseUntil = new Date(nowMs + this.config.retry.sendTimeoutMs + LEASE_SLACK_MS);
      // ── ATOMIC CLAIM ── flip a DUE PENDING/RETRYING row to RETRYING, bump attempts, and lease it
      // out of the due-window for the duration of the send. Row-locked, so a concurrent claim sees
      // the leased row and matches 0 → only one worker proceeds (no double-send).
      const claim = await this.prisma.notification.updateMany({
        where: {
          id: notificationId,
          status: { in: [NotificationStatus.PENDING, NotificationStatus.RETRYING] },
          OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date(nowMs) } }],
        },
        data: { status: NotificationStatus.RETRYING, attempts: { increment: 1 }, scheduledFor: leaseUntil },
      });
      if (claim.count !== 1) return; // lost the claim / terminal / not due

      const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
      if (!n) return;
      const attempt = n.attempts; // authoritative post-claim attempt number

      const channel = n.channel as unknown as CommsChannel;
      const transport = this.transports.get(channel);
      if (!transport) {
        await this.markFailed(n.id, n.orgId, attempt, `no transport registered for channel ${channel}`);
        return;
      }
      const payload = (n.payload ?? {}) as StoredPayload;
      const recipients = payload.recipients ?? [];
      if (recipients.length === 0) {
        // No destination address for this channel (e.g. no registered push token / no phone on file).
        await this.markSuppressed(n.id, n.orgId, 'no destination address for channel');
        return;
      }

      const msg: OutgoingMessage = { recipients, subject: payload.subject, title: payload.title, body: payload.body ?? '' };
      try {
        const result = await this.withTimeout(transport.send(msg), this.config.retry.sendTimeoutMs);
        await this.prisma.notification.updateMany({
          where: { id: n.id, orgId: n.orgId },
          data: {
            status: NotificationStatus.SENT,
            sentAt: new Date(),
            providerMessageId: result.providerMessageId ?? null,
            lastError: null,
            scheduledFor: null,
          },
        });
        this.logger.log(`sent notification ${n.id} via ${transport.name} (attempt ${attempt})`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (attempt >= this.config.retry.maxAttempts) {
          await this.markFailed(n.id, n.orgId, attempt, reason);
          this.logger.warn(`notification ${n.id} FAILED after ${attempt} attempt(s): ${reason}`);
        } else {
          const backoff = this.config.retry.backoffMs * attempt; // linear, bounded by maxAttempts
          await this.prisma.notification.updateMany({
            where: { id: n.id, orgId: n.orgId },
            data: { status: NotificationStatus.RETRYING, lastError: reason, scheduledFor: new Date(Date.now() + backoff) },
          });
          this.logger.warn(`notification ${n.id} attempt ${attempt} failed (retry in ${backoff}ms): ${reason}`);
        }
      }
    } catch (fatal) {
      // A persistence/claim error must never escape (would otherwise abort a drain batch).
      const reason = fatal instanceof Error ? fatal.message : String(fatal);
      this.logger.warn(`notification ${notificationId} attempt aborted: ${reason}`);
    }
  }

  /**
   * Drain every DUE row: fresh PENDING (scheduled_for NULL), retry-backoff RETRYING, and
   * quiet-hours-deferred PENDING whose scheduled_for has passed. The per-row atomic claim makes
   * concurrent drains (this kick + the scan + other workers) safe. Non-overlapping within a worker.
   */
  async drainDue(): Promise<number> {
    if (this.scanning) return 0;
    this.scanning = true;
    try {
      const now = new Date();
      const due = await this.prisma.notification.findMany({
        where: {
          status: { in: [NotificationStatus.PENDING, NotificationStatus.RETRYING] },
          OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }],
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      for (const row of due) await this.attemptSend(row.id); // attemptSend never throws (isolated)
      return due.length;
    } finally {
      this.scanning = false;
    }
  }

  private async markFailed(id: string, orgId: string, attempts: number, reason: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, orgId },
      data: { status: NotificationStatus.FAILED, attempts, lastError: reason, scheduledFor: null },
    });
  }

  private async markSuppressed(id: string, orgId: string, reason: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, orgId },
      data: { status: NotificationStatus.SUPPRESSED, lastError: reason, scheduledFor: null },
    });
  }

  /** Race a transport send against a timeout so a hung provider can't stall the caller. */
  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`transport timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
