import { Global, Logger, Module } from '@nestjs/common';
import twilio from 'twilio';
import { AUTH_CONFIG, type AuthConfig, loadAuthConfig } from '../../config/auth.config';

/** Token for the selected SMS transport. */
export const SMS_TRANSPORT = Symbol('SMS_TRANSPORT');

/** Result of a send — carries the provider message id (Twilio SID) when one exists. */
export interface SmsSendResult {
  /** Twilio message SID (real send). Undefined for the console transport (no provider id). */
  sid?: string;
}

/** Real, swappable transport contract. Both implementations actually send. */
export interface SmsTransport {
  readonly name: string;
  send(to: string, body: string): Promise<SmsSendResult>;
}

/**
 * Dev transport — a REAL implementation (not a mock): it logs the message so OTP
 * flows are exercisable without a phone/credentials. Selected by SMS_TRANSPORT=console.
 */
export class ConsoleSmsTransport implements SmsTransport {
  readonly name = 'console';
  private readonly logger = new Logger('ConsoleSmsTransport');
  async send(to: string, body: string): Promise<SmsSendResult> {
    this.logger.log(`SMS → ${to}: ${body}`);
    return {};
  }
}

/** Production transport — sends via the Twilio REST API (real send path). */
export class TwilioSmsTransport implements SmsTransport {
  readonly name = 'twilio';
  private readonly logger = new Logger('TwilioSmsTransport');
  private readonly client: ReturnType<typeof twilio>;
  constructor(
    private readonly accountSid: string,
    authToken: string,
    private readonly from: string,
  ) {
    this.client = twilio(accountSid, authToken);
  }
  async send(to: string, body: string): Promise<SmsSendResult> {
    const message = await this.client.messages.create({ to, from: this.from, body });
    this.logger.log(`Twilio SMS sent to ${to} (sid ${message.sid})`);
    return { sid: message.sid };
  }
}

function createTransport(config: AuthConfig): SmsTransport {
  const logger = new Logger('SmsModule');
  if (config.sms.transport === 'twilio') {
    const { accountSid, authToken, from } = config.sms.twilio;
    if (!accountSid || !authToken || !from) {
      throw new Error(
        'SMS_TRANSPORT=twilio requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER',
      );
    }
    logger.log('Using Twilio SMS transport');
    return new TwilioSmsTransport(accountSid, authToken, from);
  }
  // Fail CLOSED: the console transport echoes/logs codes, so it must never run in prod.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SMS_TRANSPORT=console is forbidden in production — set SMS_TRANSPORT=twilio with TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER',
    );
  }
  logger.warn('Using Console SMS transport (dev only) — OTP codes are logged + echoed as devCode');
  return new ConsoleSmsTransport();
}

@Global()
@Module({
  providers: [
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
    { provide: SMS_TRANSPORT, inject: [AUTH_CONFIG], useFactory: (c: AuthConfig) => createTransport(c) },
  ],
  exports: [AUTH_CONFIG, SMS_TRANSPORT],
})
export class SmsModule {}
