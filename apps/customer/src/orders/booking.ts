import type { BookItemDto, BookOrderDto, GeoPoint, ItemKind, PickupSlot, TimeWindow } from '@blue-bee/shared';

/** A line the customer is composing in the Book form before submitting. */
export interface DraftItem {
  kind: ItemKind;
  serviceId: string;
  estimatedMeasure?: number;
  notes?: string;
}

export interface BookForm {
  accountId: string;
  siteId?: string;
  items: DraftItem[];
  pickupWindow?: TimeWindow;
  notes?: string;
  /**
   * [Inc-19] The selected site's service point ({lng,lat}), when it has one. Sent as `serviceGeo` so the
   * SERVER can geo-block against active service zones (the app never decides serviceability). Omitted when
   * the site has no point (⇒ the server can't gate ⇒ books, mirroring the building-match `if (serviceGeo)`).
   */
  serviceGeo?: GeoPoint;
}

/**
 * Map the Book form to the server `BookOrderDto` (the @blue-bee/shared contract). Pure → unit-tested.
 * Throws if there are no items (the server also rejects, but failing fast is a better UX). Empty
 * optional fields are dropped so the payload matches the Zod schema exactly.
 */
export function buildBookDto(form: BookForm): BookOrderDto {
  if (!form.accountId) throw new Error('No account to book under');
  if (!form.items || form.items.length === 0) throw new Error('Add at least one item to book');

  const items: BookItemDto[] = form.items.map((it) => ({
    kind: it.kind,
    serviceId: it.serviceId,
    ...(it.estimatedMeasure && it.estimatedMeasure > 0 ? { estimatedMeasure: it.estimatedMeasure } : {}),
    ...(it.notes ? { notes: it.notes } : {}),
  }));

  return {
    accountId: form.accountId,
    ...(form.siteId ? { siteId: form.siteId } : {}),
    ...(form.pickupWindow ? { pickupWindow: form.pickupWindow } : {}),
    ...(form.notes ? { notes: form.notes } : {}),
    ...(form.serviceGeo ? { serviceGeo: form.serviceGeo } : {}),
    items,
  };
}

/**
 * A stable idempotency key for ONE booking attempt. The Book screen generates it once and REUSES it
 * on retry, so a timeout-then-retry hits the server's IdempotencyInterceptor and returns the SAME
 * order instead of double-booking (QC lens 6). Regenerated only after a successful book.
 */
export function newIdempotencyKey(rand: () => number = Math.random, now: () => number = Date.now): string {
  return `book-${now().toString(36)}-${rand().toString(36).slice(2, 10)}`;
}

/**
 * [Inc-28] The `pickupWindow` for a slot the SERVER offered.
 *
 * This replaced `tomorrowMorningWindow()`, which fabricated "tomorrow 09:00–12:00, device-local" behind a
 * Switch. That window ignored the business's real operating hours, its timezone, its lead time, and whether
 * anything was left in it. A window may now only come from `GET /v1/availability/pickup-slots`, and this
 * function does nothing but hand the server's own instants back to it — there is no arithmetic left to
 * get wrong.
 */
export function slotToWindow(slot: Pick<PickupSlot, 'start' | 'end'>): TimeWindow {
  return { start: slot.start, end: slot.end };
}
