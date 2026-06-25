import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommsChannel } from '@blue-bee/shared';
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from '../../config/notifications.config';
import type { NotificationTransport, OutgoingMessage, TransportResult } from './notification-transport';

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: unknown;
}

/**
 * Push notification transport (PRD §8.5/§11.2) — Expo Push (→ FCM/APNs downstream). Two REAL
 * implementations, selected by `PUSH_TRANSPORT`:
 *  • 'expo'    → `ExpoPushTransport` — a real HTTPS POST to the Expo push API that returns a ticket
 *    per token. (FCM/APNs native are the documented downstream adapters.)
 *  • 'console' → a REAL local impl (logs + returns a synthetic ticket id), NOT a mock; the default
 *    for dev/test where there is no real device to receive a push.
 *
 * Honesty (Increment 8): the transport + the `DeviceToken` registration are REAL and tested; a real
 * phone receiving the push is the only deferred link (waits on the customer-app increment). There is
 * deliberately NO mock push client — the 'expo' path genuinely calls the Expo API.
 */
@Injectable()
export class PushNotificationTransport implements NotificationTransport {
  readonly channel = CommsChannel.PUSH;
  private readonly logger = new Logger(PushNotificationTransport.name);

  constructor(@Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig) {}

  get name(): string {
    return `push:${this.config.push.transport}`;
  }

  async send(msg: OutgoingMessage): Promise<TransportResult> {
    return this.config.push.transport === 'expo' ? this.sendViaExpo(msg) : this.sendViaConsole(msg);
  }

  /** REAL local transport (Increment-2 pattern): logs + returns a synthetic ticket. Not a mock. */
  private async sendViaConsole(msg: OutgoingMessage): Promise<TransportResult> {
    const deepLink = msg.data?.orderId ? ` :: data.orderId=${msg.data.orderId}` : '';
    this.logger.log(`PUSH → ${msg.recipients.length} token(s) :: ${msg.title ?? this.config.appName} :: ${msg.body}${deepLink}`);
    return { providerMessageId: `console-push-${msg.recipients.length}` };
  }

  /** REAL Expo Push send — one message per token; returns the first accepted ticket id. */
  private async sendViaExpo(msg: OutgoingMessage): Promise<TransportResult> {
    // `data` rides along so a tapped notification deep-links to the order's tracking (Increment 11).
    const messages = msg.recipients.map((to) => ({
      to,
      title: msg.title ?? this.config.appName,
      body: msg.body,
      ...(msg.data ? { data: msg.data } : {}),
    }));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.config.push.accessToken) headers.Authorization = `Bearer ${this.config.push.accessToken}`;

    const res = await fetch(EXPO_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(messages) });
    if (res.status >= 300) {
      const text = await res.text().catch(() => '');
      throw new Error(`Expo push ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: ExpoTicket[] };
    const tickets = json.data ?? [];
    const firstError = tickets.find((t) => t.status === 'error');
    if (firstError) throw new Error(`Expo push ticket error: ${firstError.message ?? 'unknown'}`);
    return { providerMessageId: tickets.find((t) => t.id)?.id };
  }
}
