import { AccountType, type CustomerSite } from '@blue-bee/shared';
import {
  addressFormFromSite,
  buildCreateSiteDto,
  buildUpdateSiteDto,
  coverageNotice,
  emptyAddressForm,
  hasErrors,
  isEmptyUpdate,
  newAddressIdempotencyKey,
  validateAddressForm,
  type AddressFormValues,
} from './address';

const site = (over: Partial<CustomerSite> = {}): CustomerSite => ({
  id: 'site-1',
  accountId: 'acc-1',
  name: 'Home',
  address: '100 Queen St W, Toronto, ON',
  accountName: 'Priya',
  accountType: AccountType.RESIDENTIAL,
  geo: { lng: -79.3839, lat: 43.6534 },
  unit: '12B',
  buzzer: '1204',
  notes: 'Side door',
  isDefault: false,
  ...over,
});

const values = (over: Partial<AddressFormValues> = {}): AddressFormValues => ({
  ...emptyAddressForm(),
  name: 'Home',
  address: '100 Queen St W, Toronto, ON',
  ...over,
});

describe('validateAddressForm', () => {
  it('requires a name and an address', () => {
    const e = validateAddressForm(values({ name: '  ', address: '\t' }));
    expect(e.name).toBeDefined();
    expect(e.address).toBeDefined();
    expect(hasErrors(e)).toBe(true);
  });

  it('accepts a filled form', () => {
    expect(hasErrors(validateAddressForm(values()))).toBe(false);
  });

  it('rejects over-long values (mirrors the server Zod bounds)', () => {
    expect(validateAddressForm(values({ name: 'x'.repeat(161) })).name).toBeDefined();
    expect(validateAddressForm(values({ address: 'x'.repeat(301) })).address).toBeDefined();
  });
});

describe('buildCreateSiteDto', () => {
  it('trims and omits the optional fields left blank (never sends empty strings)', () => {
    const dto = buildCreateSiteDto(values({ name: '  Home  ', address: '  100 Queen St W  ' }));
    expect(dto).toEqual({ name: 'Home', address: '100 Queen St W' });
    expect('unit' in dto).toBe(false);
    expect('buzzer' in dto).toBe(false);
    expect('notes' in dto).toBe(false);
    expect('isDefault' in dto).toBe(false);
  });

  it('includes the optional fields when filled', () => {
    const dto = buildCreateSiteDto(values({ unit: ' 12B ', buzzer: '1204', notes: 'Side door', isDefault: true }));
    expect(dto).toMatchObject({ unit: '12B', buzzer: '1204', notes: 'Side door', isDefault: true });
  });
});

describe('buildUpdateSiteDto', () => {
  it('sends ONLY what changed (an unchanged address must not trigger a re-geocode)', () => {
    const original = site();
    const dto = buildUpdateSiteDto(addressFormFromSite(original), original);
    expect(dto).toEqual({});
    expect(isEmptyUpdate(dto)).toBe(true);
  });

  it('sends a renamed label without the address', () => {
    const original = site();
    const dto = buildUpdateSiteDto({ ...addressFormFromSite(original), name: 'Work' }, original);
    expect(dto).toEqual({ name: 'Work' });
    expect('address' in dto).toBe(false);
  });

  it('sends the address when it actually moved', () => {
    const original = site();
    const dto = buildUpdateSiteDto({ ...addressFormFromSite(original), address: '290 Bremner Blvd' }, original);
    expect(dto).toEqual({ address: '290 Bremner Blvd' });
  });

  it('sends null to CLEAR an optional field (how a buzzer code is erased)', () => {
    const original = site({ buzzer: '1204' });
    const dto = buildUpdateSiteDto({ ...addressFormFromSite(original), buzzer: '   ' }, original);
    expect(dto).toEqual({ buzzer: null });
  });

  it('treats a null original and an empty input as equal (no spurious field)', () => {
    const original = site({ unit: null, buzzer: null, notes: null });
    const dto = buildUpdateSiteDto(addressFormFromSite(original), original);
    expect(dto).toEqual({});
  });

  it('carries an isDefault flip', () => {
    const original = site({ isDefault: false });
    const dto = buildUpdateSiteDto({ ...addressFormFromSite(original), isDefault: true }, original);
    expect(dto).toEqual({ isDefault: true });
  });
});

describe('newAddressIdempotencyKey', () => {
  it('is prefixed and deterministic given injected rand/now', () => {
    expect(newAddressIdempotencyKey(() => 0.5, () => 1000)).toBe(newAddressIdempotencyKey(() => 0.5, () => 1000));
    expect(newAddressIdempotencyKey(() => 0.5, () => 1000)).toMatch(/^site-/);
  });

  it('differs across attempts', () => {
    expect(newAddressIdempotencyKey(() => 0.1, () => 1)).not.toBe(newAddressIdempotencyKey(() => 0.9, () => 2));
  });
});

describe('coverageNotice — the honesty firewall', () => {
  it('claims NOTHING when the org has no active zones (the gate is inert, not evidence of coverage)', () => {
    expect(coverageNotice({ checked: false, serviceable: false, coverageRequestId: null })).toEqual({ kind: 'none' });
    // Even if a stale `serviceable: true` came back alongside checked:false, we must still say nothing.
    expect(coverageNotice({ checked: false, serviceable: true, coverageRequestId: null })).toEqual({ kind: 'none' });
  });

  it('confirms coverage only when the server actually tested the point and it was inside a zone', () => {
    const n = coverageNotice({ checked: true, serviceable: true, coverageRequestId: null });
    expect(n.kind).toBe('covered');
  });

  it('reports out-of-area, and only promises the address was recorded when a coverageRequestId exists', () => {
    const recorded = coverageNotice({ checked: true, serviceable: false, coverageRequestId: 'cr-1' });
    expect(recorded).toMatchObject({ kind: 'out_of_area', recorded: true });

    const notRecorded = coverageNotice({ checked: true, serviceable: false, coverageRequestId: null });
    expect(notRecorded).toMatchObject({ kind: 'out_of_area', recorded: false });
  });
});
