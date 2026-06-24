import { CommsChannel, NOTIFICATION_EVENTS } from '@blue-bee/shared';
import { renderTemplate, etaSecondsToMinutes, type TemplateData } from './notification-templates';

const base: TemplateData = { appName: 'Blue Bee', driverName: 'Sam', orderRef: '#abc12345', etaMinutes: 5 };

describe('notification templates (Increment 8)', () => {
  describe('etaSecondsToMinutes', () => {
    it('rounds to whole minutes, floor 1 when positive', () => {
      expect(etaSecondsToMinutes(300)).toBe(5);
      expect(etaSecondsToMinutes(20)).toBe(1); // < 1 min rounds up to 1
      expect(etaSecondsToMinutes(0)).toBeNull();
      expect(etaSecondsToMinutes(null)).toBeNull();
      expect(etaSecondsToMinutes(undefined)).toBeNull();
    });
  });

  describe('renderTemplate — approaching', () => {
    const ev = NOTIFICATION_EVENTS.GEOFENCE_APPROACHING;
    it('SMS body carries app, driver, ETA phrase and order ref', () => {
      const r = renderTemplate(ev, CommsChannel.SMS, base);
      expect(r.subject).toBeUndefined();
      expect(r.body).toContain('Blue Bee');
      expect(r.body).toContain('Sam');
      expect(r.body).toContain('about 5 minutes away');
      expect(r.body).toContain('#abc12345');
    });
    it('EMAIL has a subject + body', () => {
      const r = renderTemplate(ev, CommsChannel.EMAIL, base);
      expect(r.subject).toBeTruthy();
      expect(r.body).toContain('#abc12345');
    });
    it('PUSH has a title + body', () => {
      const r = renderTemplate(ev, CommsChannel.PUSH, base);
      expect(r.title).toContain('approaching');
      expect(r.body).toContain('Sam');
    });
    it('omits driver name gracefully when absent', () => {
      const r = renderTemplate(ev, CommsChannel.SMS, { ...base, driverName: null });
      expect(r.body).toContain('Your Blue Bee driver is');
    });
    it('uses "almost there" when ETA is unknown', () => {
      const r = renderTemplate(ev, CommsChannel.SMS, { ...base, etaMinutes: null });
      expect(r.body).toContain('almost there');
    });
  });

  describe('renderTemplate — arrived', () => {
    const ev = NOTIFICATION_EVENTS.GEOFENCE_ARRIVED;
    it('SMS/EMAIL/PUSH all say "arrived"', () => {
      expect(renderTemplate(ev, CommsChannel.SMS, base).body).toContain('has arrived');
      expect(renderTemplate(ev, CommsChannel.EMAIL, base).subject).toContain('arrived');
      expect(renderTemplate(ev, CommsChannel.PUSH, base).title).toContain('arrived');
    });
  });

  it('throws on an unknown event type (engine invariant)', () => {
    expect(() => renderTemplate('order.invoiced', CommsChannel.SMS, base)).toThrow();
  });
});
