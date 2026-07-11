import { Logger, Module } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from '../../config/auth.config';

/** Token for the selected email transport. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Real, swappable transport contract (mirrors SmsTransport). Both implementations actually send. */
export interface EmailTransport {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev transport — a REAL implementation (not a mock): it logs the email so verify/reset flows are
 * exercisable without a mailbox. Selected by EMAIL_TRANSPORT=console. Fail-closed in production.
 */
export class ConsoleEmailTransport implements EmailTransport {
  readonly name = 'console';
  private readonly logger = new Logger('ConsoleEmailTransport');
  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`EMAIL → ${message.to} · ${message.subject}\n${message.text}`);
  }
}

/**
 * Production transport — sends via the SendGrid v3 REST API over `fetch` (no SDK dependency). Real send
 * path; requires SENDGRID_API_KEY. Never runs in dev (console is the default there).
 */
export class SendGridEmailTransport implements EmailTransport {
  readonly name = 'sendgrid';
  private readonly logger = new Logger('SendGridEmailTransport');
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: this.from },
        subject: message.subject,
        content: [{ type: 'text/plain', value: message.text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SendGrid send failed (${res.status}): ${body.slice(0, 200)}`);
    }
    this.logger.log(`SendGrid email sent to ${message.to}`);
  }
}

function createTransport(config: AuthConfig): EmailTransport {
  const logger = new Logger('EmailModule');
  if (config.email.transport === 'sendgrid') {
    if (!config.email.sendgridApiKey) {
      throw new Error('EMAIL_TRANSPORT=sendgrid requires SENDGRID_API_KEY');
    }
    logger.log('Using SendGrid email transport');
    return new SendGridEmailTransport(config.email.sendgridApiKey, config.email.from);
  }
  // Fail CLOSED: the console transport logs tokens, so it must never run in prod.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('EMAIL_TRANSPORT=console is forbidden in production — set EMAIL_TRANSPORT=sendgrid + SENDGRID_API_KEY');
  }
  logger.warn('Using Console email transport (dev only) — verify/reset tokens are logged + echoed as devToken');
  return new ConsoleEmailTransport();
}

// AUTH_CONFIG comes from the global SmsModule (already provided app-wide) — no need to re-provide it.
@Module({
  providers: [{ provide: EMAIL_TRANSPORT, inject: [AUTH_CONFIG], useFactory: (c: AuthConfig) => createTransport(c) }],
  exports: [EMAIL_TRANSPORT],
})
export class EmailModule {}
