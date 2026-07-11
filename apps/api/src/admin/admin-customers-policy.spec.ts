import { bookedByCustomer, orderTotals, toNotificationView, toServiceability } from './admin-customers-policy';

describe('orderTotals', () => {
  it('reads a decimal-string total and its currency', () => {
    expect(orderTotals({ total: '158.20', currency: 'CAD' })).toEqual({ total: '158.20', currency: 'CAD' });
  });

  it('formats a numeric total to fixed-2 money (Prisma JSON can hand back a number)', () => {
    expect(orderTotals({ total: 42, currency: 'USD' })).toEqual({ total: '42.00', currency: 'USD' });
  });

  it('preserves a decimal string exactly, trailing zero and all', () => {
    // `Decimal.toString()` would render "158.20" as "158.2" → "$158.2" in the console.
    expect(orderTotals({ total: '158.20' }).total).toBe('158.20');
  });

  it('an UNPRICED order has no total — null, never "0"', () => {
    // Rendering 0 would tell staff the customer owes nothing; in truth the order is not quoted yet.
    expect(orderTotals({}).total).toBeNull();
    expect(orderTotals(null).total).toBeNull();
    expect(orderTotals(undefined).total).toBeNull();
    expect(orderTotals('nonsense').total).toBeNull();
    expect(orderTotals({ total: null }).total).toBeNull();
    expect(orderTotals({ total: {} }).total).toBeNull();
  });

  it('rejects a non-finite total rather than emitting "NaN"/"Infinity"', () => {
    expect(orderTotals({ total: Number.NaN }).total).toBeNull();
    expect(orderTotals({ total: Number.POSITIVE_INFINITY }).total).toBeNull();
  });

  it('defaults the currency to CAD when absent or blank', () => {
    expect(orderTotals({ total: '1.00' }).currency).toBe('CAD');
    expect(orderTotals({ total: '1.00', currency: '' }).currency).toBe('CAD');
    expect(orderTotals({ total: '1.00', currency: 7 }).currency).toBe('CAD');
  });
});

describe('bookedByCustomer', () => {
  const CUSTOMER = 'cust-1';

  it('true when this customer created the order', () => {
    expect(bookedByCustomer(CUSTOMER, CUSTOMER)).toBe(true);
  });

  it('false when someone else (e.g. staff) created it', () => {
    expect(bookedByCustomer('staff-9', CUSTOMER)).toBe(false);
  });

  it('NULL — not false — when `createdBy` is unset: we do not know who booked it', () => {
    // `false` would render as "booked by staff", a claim the data does not support.
    expect(bookedByCustomer(null, CUSTOMER)).toBeNull();
  });
});

describe('toNotificationView', () => {
  it('marks a real preference row as configured and echoes it verbatim', () => {
    const view = toNotificationView({
      pushEnabled: false,
      smsEnabled: true,
      emailEnabled: false,
      quietHoursStart: 1320,
      quietHoursEnd: 420,
      timezone: 'America/Vancouver',
    });
    expect(view).toEqual({
      configured: true,
      pushEnabled: false,
      smsEnabled: true,
      emailEnabled: false,
      quietHoursStart: 1320,
      quietHoursEnd: 420,
      timezone: 'America/Vancouver',
    });
  });

  it('no preference row ⇒ configured:false, so a server DEFAULT is never shown as a customer choice', () => {
    const view = toNotificationView(null);
    expect(view.configured).toBe(false);
    // The defaults are still reported (that IS the live behaviour) — the flag is what stops the console
    // from captioning them "the customer enabled SMS".
    expect(view).toMatchObject({ pushEnabled: true, smsEnabled: true, emailEnabled: true, timezone: 'America/Toronto' });
    expect(view.quietHoursStart).toBeNull();
    expect(view.quietHoursEnd).toBeNull();
  });
});

describe('toServiceability — the honesty firewall', () => {
  it('no active zones ⇒ checked:false: an inert gate is NOT evidence of coverage', () => {
    expect(toServiceability({ hasActiveZones: false, covered: false })).toEqual({
      checked: false,
      serviceable: false,
      coverageRequestId: null,
    });
  });

  it('no active zones still reports serviceable:false even if the gate says "covered"', () => {
    // ST_Covers over zero polygons cannot be true, but the type allows it — never launder it into a claim.
    expect(toServiceability({ hasActiveZones: false, covered: true }).serviceable).toBe(false);
  });

  it('inside an active zone ⇒ checked + serviceable', () => {
    expect(toServiceability({ hasActiveZones: true, covered: true })).toEqual({
      checked: true,
      serviceable: true,
      coverageRequestId: null,
    });
  });

  it('outside every active zone ⇒ checked, not serviceable', () => {
    expect(toServiceability({ hasActiveZones: true, covered: false })).toMatchObject({ checked: true, serviceable: false });
  });

  it('never returns a coverageRequestId — the 360 is a READ and captures no demand', () => {
    for (const gate of [
      { hasActiveZones: true, covered: false },
      { hasActiveZones: true, covered: true },
      { hasActiveZones: false, covered: false },
    ]) {
      expect(toServiceability(gate).coverageRequestId).toBeNull();
    }
  });
});
