/**
 * Notification templates (Increment 8, §8.5) — PURE per-channel renderers for the geofence
 * customer alerts (§6.4 US-T2). EN only this phase (FR is P2). Kept pure so rendering is
 * unit-tested directly. A channel-specific shape: SMS uses `body`; email uses `subject`+`body`;
 * push uses `title`+`body`.
 */
import { CommsChannel, NOTIFICATION_EVENTS } from '@blue-bee/shared';

export interface TemplateData {
  appName: string;
  /** The driver's display name, when resolvable. */
  driverName?: string | null;
  /** A short human order reference for the customer. */
  orderRef: string;
  /** Remaining ETA in whole minutes (approaching only); null/absent ⇒ omit the time phrase. */
  etaMinutes?: number | null;
  /** Money amount as a fixed-2 dollar string (payment events). */
  amount?: string | null;
  /** ISO 4217 currency (payment events). */
  currency?: string | null;
  /** Dispute/refund reason or short note (payment events). */
  reason?: string | null;
}

export interface RenderedTemplate {
  subject?: string; // email
  title?: string; // push
  body: string; // all channels
}

/** "about 5 minutes away" / "about 1 minute away" / "almost there" (no/zero ETA). */
function etaPhrase(mins?: number | null): string {
  if (mins == null || !Number.isFinite(mins) || mins <= 0) return 'almost there';
  if (mins <= 1) return 'about 1 minute away';
  return `about ${mins} minutes away`;
}

/** "Your Blue Bee driver" / "Your Blue Bee driver Sam". */
function driverNoun(d: TemplateData): string {
  const who = d.driverName && d.driverName.trim() ? ` ${d.driverName.trim()}` : '';
  return `Your ${d.appName} driver${who}`;
}

/** "$293.80 CAD" / "your" (when no amount) — for payment templates. */
function moneyPhrase(d: TemplateData): string {
  if (!d.amount || !d.amount.trim()) return 'your';
  const cur = d.currency && d.currency.trim() ? ` ${d.currency.trim().toUpperCase()}` : '';
  return `$${d.amount.trim()}${cur}`;
}

/** Convert ETA seconds → whole minutes for the "~N min" phrase (min 1 when positive). */
export function etaSecondsToMinutes(etaSeconds?: number | null): number | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0) return null;
  return Math.max(1, Math.round(etaSeconds / 60));
}

/** Render one (eventType, channel) message. Throws on an unknown event type (engine invariant). */
export function renderTemplate(eventType: string, channel: CommsChannel, data: TemplateData): RenderedTemplate {
  switch (eventType) {
    case NOTIFICATION_EVENTS.GEOFENCE_APPROACHING: {
      const phrase = etaPhrase(data.etaMinutes);
      const line = `${driverNoun(data)} is ${phrase} for order ${data.orderRef}.`;
      if (channel === CommsChannel.EMAIL) {
        return { subject: `Your ${data.appName} driver is on the way`, body: `${line}\n\nWe'll let you know when they arrive.` };
      }
      if (channel === CommsChannel.PUSH) {
        return { title: `${data.appName} — driver approaching`, body: line };
      }
      return { body: `${data.appName}: ${line}` }; // SMS
    }
    case NOTIFICATION_EVENTS.GEOFENCE_ARRIVED: {
      const line = `${driverNoun(data)} has arrived for order ${data.orderRef}.`;
      if (channel === CommsChannel.EMAIL) {
        return { subject: `Your ${data.appName} driver has arrived`, body: line };
      }
      if (channel === CommsChannel.PUSH) {
        return { title: `${data.appName} — driver arrived`, body: line };
      }
      return { body: `${data.appName}: ${line}` }; // SMS
    }
    case NOTIFICATION_EVENTS.PAYMENT_RECEIPT: {
      const amt = moneyPhrase(data);
      const line = `Payment of ${amt} received for order ${data.orderRef}. Thank you!`;
      if (channel === CommsChannel.EMAIL) {
        return { subject: `Your ${data.appName} receipt for order ${data.orderRef}`, body: `${line}\n\nThis is your receipt — keep it for your records.` };
      }
      if (channel === CommsChannel.PUSH) {
        return { title: `${data.appName} — payment received`, body: line };
      }
      return { body: `${data.appName}: ${line}` }; // SMS
    }
    case NOTIFICATION_EVENTS.PAYMENT_FAILED: {
      const amt = moneyPhrase(data);
      const line = `We couldn't process your ${amt} payment for order ${data.orderRef}. Please try again in the app.`;
      if (channel === CommsChannel.EMAIL) {
        return { subject: `Action needed: payment failed for order ${data.orderRef}`, body: line };
      }
      if (channel === CommsChannel.PUSH) {
        return { title: `${data.appName} — payment failed`, body: line };
      }
      return { body: `${data.appName}: ${line}` }; // SMS
    }
    case NOTIFICATION_EVENTS.PAYMENT_DISPUTE: {
      const amt = moneyPhrase(data);
      const why = data.reason && data.reason.trim() ? ` (reason: ${data.reason.trim()})` : '';
      const line = `A payment dispute for ${amt} was opened on order ${data.orderRef}${why}. Review and respond in the dashboard.`;
      if (channel === CommsChannel.EMAIL) {
        return { subject: `Dispute opened on order ${data.orderRef}`, body: line };
      }
      if (channel === CommsChannel.PUSH) {
        return { title: `${data.appName} — dispute opened`, body: line };
      }
      return { body: `${data.appName}: ${line}` }; // SMS
    }
    default:
      throw new Error(`no template for notification event type "${eventType}"`);
  }
}
