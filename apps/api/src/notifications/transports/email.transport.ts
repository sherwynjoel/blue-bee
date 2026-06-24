import { Inject, Injectable, Logger } from '@nestjs/common';
import { CommsChannel } from '@blue-bee/shared';
import { NOTIFICATIONS_CONFIG, type NotificationsConfig } from '../../config/notifications.config';
import type { NotificationTransport, OutgoingMessage, TransportResult } from './notification-transport';

const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send';

/**
 * Email notification transport (PRD §8.5/§11.2). Two REAL implementations, selected by whether a
 * `SENDGRID_API_KEY` is configured:
 *  • with a key  → `SendgridEmailTransport` — a real HTTPS call to the SendGrid v3 API, in SANDBOX
 *    mode by default (validates + 200, no delivery). The accepted message id is the
 *    `x-message-id` response header.
 *  • without one → `ConsoleEmailTransport` — a REAL local impl (logs the rendered email + returns a
 *    synthetic id), NOT a mock; lets the engine run end-to-end without a provider account.
 * (AWS SES is the documented alternative adapter.)
 */
@Injectable()
export class EmailNotificationTransport implements NotificationTransport {
  readonly channel = CommsChannel.EMAIL;
  private readonly logger = new Logger(EmailNotificationTransport.name);

  constructor(@Inject(NOTIFICATIONS_CONFIG) private readonly config: NotificationsConfig) {}

  get name(): string {
    return this.config.email.apiKey ? 'email:sendgrid' : 'email:console';
  }

  async send(msg: OutgoingMessage): Promise<TransportResult> {
    const { apiKey } = this.config.email;
    return apiKey ? this.sendViaSendgrid(msg, apiKey) : this.sendViaConsole(msg);
  }

  /** REAL local transport (Increment-2 pattern): logs + returns a synthetic id. Not a mock. */
  private async sendViaConsole(msg: OutgoingMessage): Promise<TransportResult> {
    this.logger.log(`EMAIL → ${msg.recipients.join(', ')} :: ${msg.subject ?? '(no subject)'} :: ${msg.body}`);
    return { providerMessageId: `console-email-${msg.recipients[0] ?? 'none'}` };
  }

  /** REAL SendGrid v3 send (sandbox by default — validates, returns 202, no delivery). */
  private async sendViaSendgrid(msg: OutgoingMessage, apiKey: string): Promise<TransportResult> {
    const { fromEmail, fromName, sandbox } = this.config.email;
    const payload = {
      personalizations: [{ to: msg.recipients.map((email) => ({ email })) }],
      from: { email: fromEmail, name: fromName },
      subject: msg.subject ?? this.config.appName,
      content: [{ type: 'text/plain', value: msg.body }],
      mail_settings: { sandbox_mode: { enable: sandbox } },
    };
    const res = await fetch(SENDGRID_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status >= 300) {
      const text = await res.text().catch(() => '');
      throw new Error(`SendGrid ${res.status}: ${text.slice(0, 300)}`);
    }
    return { providerMessageId: res.headers.get('x-message-id') ?? undefined };
  }
}
