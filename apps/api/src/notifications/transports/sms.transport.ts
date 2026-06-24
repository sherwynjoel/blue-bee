import { Inject, Injectable } from '@nestjs/common';
import { CommsChannel } from '@blue-bee/shared';
import { SMS_TRANSPORT, type SmsTransport } from '../../auth/sms/sms.module';
import type { NotificationTransport, OutgoingMessage, TransportResult } from './notification-transport';

/**
 * SMS notification transport (PRD §8.5/§11.2) — REUSES the Increment-2 `SMS_TRANSPORT` seam
 * (env-selected `ConsoleSmsTransport` dev / `TwilioSmsTransport` prod). No second Twilio client.
 * Sends the rendered body to each recipient phone; surfaces the Twilio SID (real send) as the
 * provider message id.
 */
@Injectable()
export class SmsNotificationTransport implements NotificationTransport {
  readonly channel = CommsChannel.SMS;

  constructor(@Inject(SMS_TRANSPORT) private readonly sms: SmsTransport) {}

  get name(): string {
    return `sms:${this.sms.name}`;
  }

  async send(msg: OutgoingMessage): Promise<TransportResult> {
    let providerMessageId: string | undefined;
    for (const to of msg.recipients) {
      const res = await this.sms.send(to, msg.body);
      providerMessageId = res.sid ?? providerMessageId;
    }
    return { providerMessageId };
  }
}
