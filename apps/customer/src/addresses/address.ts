import type { CreateSiteDto, CustomerSite, SiteServiceability, UpdateSiteDto } from '@blue-bee/shared';

/**
 * Saved-address form logic (Increment 26), kept out of the screens so it is directly testable.
 *
 * The screens own pixels; this module owns the two decisions that must not drift:
 *   • what we SEND (a PATCH must carry only the fields that actually changed — the server's
 *     `updateSiteSchema.refine()` rejects an empty body, and re-sending an unchanged `address` would
 *     force a pointless re-geocode against a rate-limited upstream);
 *   • what we SAY about coverage (never more than the server's three-state answer supports).
 */

/** The raw text the form holds. Trimming/validation happens on the way out. */
export interface AddressFormValues {
  /** The label — "Home", "Work", free text. Persisted as `Site.name`. */
  name: string;
  address: string;
  unit: string;
  buzzer: string;
  notes: string;
  isDefault: boolean;
}

export type AddressFormErrors = Partial<Record<'name' | 'address', string>>;

export const emptyAddressForm = (): AddressFormValues => ({
  name: '',
  address: '',
  unit: '',
  buzzer: '',
  notes: '',
  isDefault: false,
});

/** Hydrate the form from an existing saved address (edit mode). */
export function addressFormFromSite(site: CustomerSite): AddressFormValues {
  return {
    name: site.name,
    address: site.address ?? '',
    unit: site.unit ?? '',
    buzzer: site.buzzer ?? '',
    notes: site.notes ?? '',
    isDefault: site.isDefault,
  };
}

/**
 * Client-side validation is a courtesy (instant feedback), never the authority: the server re-validates
 * with the same Zod schema, and only the server can say whether an address actually resolves.
 */
export function validateAddressForm(v: AddressFormValues): AddressFormErrors {
  const errors: AddressFormErrors = {};
  if (v.name.trim().length === 0) errors.name = 'Give this address a name, like Home or Work.';
  else if (v.name.trim().length > 160) errors.name = 'That name is too long.';
  if (v.address.trim().length === 0) errors.address = 'Enter the street address.';
  else if (v.address.trim().length > 300) errors.address = 'That address is too long.';
  return errors;
}

export const hasErrors = (e: AddressFormErrors): boolean => Object.keys(e).length > 0;

/** Trim, and drop the optional fields the customer left blank rather than sending empty strings. */
export function buildCreateSiteDto(v: AddressFormValues): CreateSiteDto {
  const dto: CreateSiteDto = { name: v.name.trim(), address: v.address.trim() };
  if (v.unit.trim()) dto.unit = v.unit.trim();
  if (v.buzzer.trim()) dto.buzzer = v.buzzer.trim();
  if (v.notes.trim()) dto.notes = v.notes.trim();
  if (v.isDefault) dto.isDefault = true;
  return dto;
}

/**
 * The changed fields only. A cleared optional field is sent as `null` (the server's schema accepts
 * nullable unit/buzzer/notes) — that is how the customer erases a buzzer code. Returns an empty object
 * when nothing moved, which the caller must treat as "no request to make".
 */
export function buildUpdateSiteDto(v: AddressFormValues, original: CustomerSite): UpdateSiteDto {
  const dto: Record<string, unknown> = {};
  const name = v.name.trim();
  const address = v.address.trim();
  if (name !== original.name) dto.name = name;
  if (address !== (original.address ?? '')) dto.address = address;

  const optional = [
    ['unit', v.unit, original.unit],
    ['buzzer', v.buzzer, original.buzzer],
    ['notes', v.notes, original.notes],
  ] as const;
  for (const [key, next, prev] of optional) {
    const trimmed = next.trim();
    const before = prev ?? '';
    if (trimmed !== before) dto[key] = trimmed.length > 0 ? trimmed : null;
  }
  if (v.isDefault !== original.isDefault) dto.isDefault = v.isDefault;
  return dto as UpdateSiteDto;
}

export const isEmptyUpdate = (dto: UpdateSiteDto): boolean => Object.keys(dto).length === 0;

/** A stable key per save attempt, so a timeout-then-retry cannot save the same address twice. */
export function newAddressIdempotencyKey(rand: () => number = Math.random, now: () => number = Date.now): string {
  return `site-${now().toString(36)}-${rand().toString(36).slice(2, 10)}`;
}

/**
 * What we are allowed to tell the customer about coverage, given the server's answer.
 *
 * `checked: false` means the org has drawn no active service zones, so the geo-gate is inert. It is NOT
 * evidence of coverage, and we say nothing — showing "we serve your area" here would be a fabricated
 * claim (CLAUDE.md honesty firewall). Likewise we only promise we recorded the address when the server
 * actually handed back a `coverageRequestId`.
 */
export type CoverageNotice =
  | { kind: 'none' }
  | { kind: 'covered'; message: string }
  | { kind: 'out_of_area'; message: string; recorded: boolean };

export function coverageNotice(s: SiteServiceability): CoverageNotice {
  if (!s.checked) return { kind: 'none' };
  if (s.serviceable) return { kind: 'covered', message: 'Good news — we serve this address.' };
  return {
    kind: 'out_of_area',
    message: "We don't reach this address yet. It's saved, but you can't book a pickup here.",
    recorded: s.coverageRequestId !== null,
  };
}
