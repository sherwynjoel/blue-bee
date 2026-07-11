import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CommsChannel, NOTIFICATION_EVENTS, NotificationStatus } from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from '../config/notifications.config';
import { NotificationRecipientsService, type RecipientUser } from './notification-recipients.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { decideChannel } from './notification-policy';
import { etaSecondsToMinutes, renderTemplate } from './notification-templates';
import { NotificationProcessor } from './notification-processor.service';

/**
 * A geofence crossing that should raise customer notifications (the dispatch input). Built by the
 * tracking layer from a NEWLY-written GeofenceEvent row (once per stop per type, Increment 7).
 */
export interface GeofenceNotification {
  /** The durable GeofenceEvent row id — the dedup source id (one alert per source × recipient × channel). */
  geofenceEventId: string;
  kind: 'APPROACHING' | 'ARRIVED';
  orderId: string | null;
  stopId: string;
  vehicleId: string;
  occurredAt: Date;
  etaSeconds: number | null;
}

/**
 * The notification engine (Increment 8, §8.5/§17.2) — turns a geofence crossing into customer
 * alerts across the matrix-driven channel set. Pipeline per (recipient × channel):
 *   resolve owning customers → apply the §17.2 matrix → preference/quiet-hours decision →
 *   render the template → resolve the channel address → enqueue ONE idempotent outbox row
 *   (unique dedupe_key + ON CONFLICT DO NOTHING). Sending is then done by the processor's drain
 *   (kicked in the background here, and run by the prod scan) — never on the ingest request thread.
 *
 * Idempotent: a re-fired/replayed/concurrent trigger appends zero duplicates (the dedup key is the
 * second line of defense behind the once-per-stop GeofenceEvent). Degradation-safe: this is called
 * from the degradation-wrapped advance hook, every per-event step is isolated, and the only awaited
 * work is the DB enqueue — so nothing here can fail (or slow) the geofence write or
 * `POST /locations:batch`.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig,
    private readonly recipients: NotificationRecipientsService,
    private readonly preferences: NotificationPreferencesService,
    private readonly processor: NotificationProcessor,
  ) {}

  /** Dispatch all geofence-driven alerts for a batch of fired events (each isolated). */
  async dispatchGeofence(orgId: string, events: GeofenceNotification[]): Promise<void> {
    for (const ev of events) {
      try {
        await this.dispatchOne(orgId, ev);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`notification dispatch skipped for geofence ${ev.geofenceEventId}: ${reason}`);
      }
    }
  }

  private async dispatchOne(orgId: string, ev: GeofenceNotification): Promise<void> {
    if (!ev.orderId) return; // no order ⇒ no owning customer to notify
    const eventType =
      ev.kind === 'ARRIVED' ? NOTIFICATION_EVENTS.GEOFENCE_ARRIVED : NOTIFICATION_EVENTS.GEOFENCE_APPROACHING;
    const channels = this.config.matrix[eventType] ?? [];
    if (channels.length === 0) return;

    const recipients = await this.recipients.resolveOrderRecipients(orgId, ev.orderId);
    if (recipients.length === 0) return;

    const driverName = await this.recipients.driverNameForStop(orgId, ev.stopId);
    const orderRef = shortOrderRef(ev.orderId);
    const etaMinutes = etaSecondsToMinutes(ev.etaSeconds);
    const urgent = this.config.urgentEventTypes.has(eventType);
    const now = new Date();
    let anyDue = false;

    for (const r of recipients) {
      const pref = await this.preferences.load(orgId, r.userId);
      for (const channel of channels) {
        const decision = decideChannel(
          pref,
          channel,
          urgent,
          now,
          this.config.quietHours.policy,
          this.config.quietHours.defaultTimezone,
        );
        const rendered = renderTemplate(eventType, channel, {
          appName: this.config.appName,
          driverName,
          orderRef,
          etaMinutes,
        });
        const addresses = await this.addressesFor(orgId, channel, r);

        // Decide the row's enqueue state. Opt-out / quiet-hours-suppress / no-address ⇒ SUPPRESSED
        // (a durable audit trail); quiet-hours-defer ⇒ PENDING held until the window ends; else
        // PENDING due now (and queued for the inline first attempt).
        let status: NotificationStatus = NotificationStatus.PENDING;
        let scheduledFor: Date | null = null;
        let lastError: string | null = null;
        let dueNow = false;
        if (decision.action === 'suppress') {
          status = NotificationStatus.SUPPRESSED;
          lastError = decision.reason;
        } else if (addresses.length === 0) {
          status = NotificationStatus.SUPPRESSED;
          lastError = 'no destination address for channel';
        } else if (decision.action === 'defer') {
          status = NotificationStatus.PENDING;
          scheduledFor = decision.scheduledFor;
        } else {
          status = NotificationStatus.PENDING;
          dueNow = true;
        }

        const insertedId = await this.insertOnce({
          orgId,
          userId: r.userId,
          eventType,
          channel,
          status,
          urgent,
          sourceType: 'GeofenceEvent',
          sourceId: ev.geofenceEventId,
          dedupeKey: `${ev.geofenceEventId}:${r.userId}:${channel}`,
          scheduledFor,
          lastError,
          // `orderId` is persisted so the PUSH transport can deep-link a tapped notification to the
          // owning order's tracking screen (Increment 11); SMS/email ignore it.
          payload: { recipients: addresses, subject: rendered.subject, title: rendered.title, body: rendered.body, eventType, orderId: ev.orderId },
        });
        if (insertedId && dueNow) anyDue = true;
      }
    }

    // Sending is OFF the request thread: we only ENQUEUE here (fast, DB-only, bounded), then kick a
    // one-off drain in the BACKGROUND so a transport call can never add latency to POST
    // /locations:batch. The drain claims each row atomically (no double-send) and is the sole sender
    // (the prod NOTIF_RETRY_SCAN_MS scan is the same path). Fire-and-forget — the kick never throws.
    if (anyDue && this.config.retry.kickOnDispatch) {
      void this.processor.drainDue().catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`notification drain kick failed: ${reason}`);
      });
    }
  }

  /** Channel destination addresses for a recipient: phone (SMS), email (EMAIL), push tokens (PUSH). */
  private async addressesFor(orgId: string, channel: CommsChannel, r: RecipientUser): Promise<string[]> {
    switch (channel) {
      case CommsChannel.SMS:
        return r.phone ? [r.phone] : [];
      case CommsChannel.EMAIL:
        return r.email ? [r.email] : [];
      case CommsChannel.PUSH:
        return this.recipients.activePushTokens(orgId, r.userId);
      default:
        return [];
    }
  }

  /**
   * Idempotent outbox insert (the Increment-5 pattern): ON CONFLICT (dedupe_key) DO NOTHING. Returns
   * the new row id when a row was written, or null on conflict (the alert already exists for this
   * event × recipient × channel) — so a re-fire/replay/concurrent trigger sends exactly once.
   */
  private async insertOnce(row: {
    orgId: string;
    userId: string;
    eventType: string;
    channel: CommsChannel;
    status: NotificationStatus;
    urgent: boolean;
    sourceType: string;
    sourceId: string;
    dedupeKey: string;
    scheduledFor: Date | null;
    lastError: string | null;
    payload: Record<string, unknown>;
  }): Promise<string | null> {
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      INSERT INTO "Notification" (
        "id", "org_id", "user_id", "event_type", "channel", "payload", "status",
        "source_type", "source_id", "dedupe_key", "urgent", "attempts", "last_error",
        "scheduled_for", "created_at", "updated_at", "created_by"
      ) VALUES (
        ${id}::uuid, ${row.orgId}::uuid, ${row.userId}::uuid, ${row.eventType},
        ${row.channel}::"CommsChannel", ${JSON.stringify(row.payload)}::jsonb,
        ${row.status}::"NotificationStatus", ${row.sourceType}, ${row.sourceId}::uuid, ${row.dedupeKey},
        ${row.urgent}, 0, ${row.lastError}, ${row.scheduledFor}, now(), now(), NULL
      )
      ON CONFLICT ("dedupe_key") DO NOTHING
      RETURNING id::text AS "id"
    `);
    return rows[0]?.id ?? null;
  }

  // ─────────────────────────── payment notifications (Increment 12) ───────────────────────────

  /**
   * Dispatch a payment-rail notification (receipt / dunning / dispute alert) through the SAME outbox
   * engine as geofence alerts — matrix → preference/quiet-hours → render → ONE idempotent row per
   * (source × event × recipient × channel). `recipientScope` decides WHO (§17.3): 'customer' resolves
   * the owning customer(s) of the order (receipts + dunning); 'staff' resolves org owner/finance
   * (dispute alerts). Fully isolated (never throws) so a notification failure can never corrupt the
   * payment state the webhook just committed.
   */
  async dispatchPayment(input: {
    orgId: string;
    eventType: string;
    /** Durable dedup source row id (uuid) — the Payment or Dispute id. */
    sourceType: 'Payment' | 'Dispute';
    sourceId: string;
    orderId: string | null;
    /** Account fallback for resolving customer recipients when there is no order (invoice-level pay). */
    accountId?: string | null;
    recipientScope: 'customer' | 'staff';
    amount?: string | null;
    currency?: string | null;
    reason?: string | null;
  }): Promise<void> {
    try {
      const channels = this.config.matrix[input.eventType] ?? [];
      if (channels.length === 0) return;

      const recipients =
        input.recipientScope === 'staff'
          ? await this.recipients.resolveOrgStaffRecipients(input.orgId)
          : input.orderId
            ? await this.recipients.resolveOrderRecipients(input.orgId, input.orderId)
            : input.accountId
              ? await this.recipients.resolveAccountRecipients(input.orgId, input.accountId)
              : [];
      if (recipients.length === 0) return;

      const orderRef = input.orderId ? shortOrderRef(input.orderId) : `#${input.sourceId.slice(0, 8)}`;
      const urgent = this.config.urgentEventTypes.has(input.eventType);
      const now = new Date();
      let anyDue = false;

      for (const r of recipients) {
        const pref = await this.preferences.load(input.orgId, r.userId);
        for (const channel of channels) {
          const decision = decideChannel(
            pref,
            channel,
            urgent,
            now,
            this.config.quietHours.policy,
            this.config.quietHours.defaultTimezone,
          );
          const rendered = renderTemplate(input.eventType, channel, {
            appName: this.config.appName,
            orderRef,
            amount: input.amount,
            currency: input.currency,
            reason: input.reason,
          });
          const addresses = await this.addressesFor(input.orgId, channel, r);

          let status: NotificationStatus = NotificationStatus.PENDING;
          let scheduledFor: Date | null = null;
          let lastError: string | null = null;
          let dueNow = false;
          if (decision.action === 'suppress') {
            status = NotificationStatus.SUPPRESSED;
            lastError = decision.reason;
          } else if (addresses.length === 0) {
            status = NotificationStatus.SUPPRESSED;
            lastError = 'no destination address for channel';
          } else if (decision.action === 'defer') {
            scheduledFor = decision.scheduledFor;
          } else {
            dueNow = true;
          }

          const insertedId = await this.insertOnce({
            orgId: input.orgId,
            userId: r.userId,
            eventType: input.eventType,
            channel,
            status,
            urgent,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            dedupeKey: `${input.sourceId}:${input.eventType}:${r.userId}:${channel}`,
            scheduledFor,
            lastError,
            payload: {
              recipients: addresses,
              subject: rendered.subject,
              title: rendered.title,
              body: rendered.body,
              eventType: input.eventType,
              orderId: input.orderId,
            },
          });
          if (insertedId && dueNow) anyDue = true;
        }
      }

      if (anyDue && this.config.retry.kickOnDispatch) {
        void this.processor.drainDue().catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(`payment notification drain kick failed: ${reason}`);
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`payment notification dispatch failed (${input.eventType} ${input.sourceId}): ${reason}`);
    }
  }

  // ─────────────────────────── rate-request (Increment 32) ───────────────────────────

  /**
   * Enqueue a RATE_REQUEST for the owning customer of a just-DELIVERED order — same outbox engine as the
   * geofence/payment alerts (matrix → preference/quiet-hours → render → ONE idempotent row per
   * source × event × recipient × channel). The durable source is the Order itself (`sourceId = orderId`),
   * so a re-completed / replayed delivery appends zero duplicates. Fully isolated (never throws) so a
   * notification failure can never fail or slow the delivery transition that just committed.
   */
  async dispatchRateRequest(orgId: string, orderId: string): Promise<void> {
    try {
      const eventType = NOTIFICATION_EVENTS.RATE_REQUEST;
      const channels = this.config.matrix[eventType] ?? [];
      if (channels.length === 0) return;

      const recipients = await this.recipients.resolveOrderRecipients(orgId, orderId);
      if (recipients.length === 0) return;

      const orderRef = shortOrderRef(orderId);
      const urgent = this.config.urgentEventTypes.has(eventType);
      const now = new Date();
      let anyDue = false;

      for (const r of recipients) {
        const pref = await this.preferences.load(orgId, r.userId);
        for (const channel of channels) {
          const decision = decideChannel(
            pref,
            channel,
            urgent,
            now,
            this.config.quietHours.policy,
            this.config.quietHours.defaultTimezone,
          );
          const rendered = renderTemplate(eventType, channel, { appName: this.config.appName, orderRef });
          const addresses = await this.addressesFor(orgId, channel, r);

          let status: NotificationStatus = NotificationStatus.PENDING;
          let scheduledFor: Date | null = null;
          let lastError: string | null = null;
          let dueNow = false;
          if (decision.action === 'suppress') {
            status = NotificationStatus.SUPPRESSED;
            lastError = decision.reason;
          } else if (addresses.length === 0) {
            status = NotificationStatus.SUPPRESSED;
            lastError = 'no destination address for channel';
          } else if (decision.action === 'defer') {
            scheduledFor = decision.scheduledFor;
          } else {
            dueNow = true;
          }

          const insertedId = await this.insertOnce({
            orgId,
            userId: r.userId,
            eventType,
            channel,
            status,
            urgent,
            sourceType: 'Order',
            sourceId: orderId,
            dedupeKey: `${orderId}:${eventType}:${r.userId}:${channel}`,
            scheduledFor,
            lastError,
            payload: { recipients: addresses, subject: rendered.subject, title: rendered.title, body: rendered.body, eventType, orderId },
          });
          if (insertedId && dueNow) anyDue = true;
        }
      }

      if (anyDue && this.config.retry.kickOnDispatch) {
        void this.processor.drainDue().catch((err) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.logger.warn(`rate-request notification drain kick failed: ${reason}`);
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`rate-request notification dispatch failed (order ${orderId}): ${reason}`);
    }
  }
}

/** A short, customer-facing order reference derived from the order id (no order-number column yet). */
function shortOrderRef(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}
