import { createNavigationContainerRef } from '@react-navigation/native';
import type { ItemKind, PricingUnit } from '@blue-bee/shared';

/**
 * Params for the Book composer.
 * [Inc-23] Optional card context — tapping a Home service card pre-selects its backing service.
 * [Inc-26] `preselectSiteId` — set when returning from AddressForm, so the address just saved is the one
 * selected in the picker. Additive: `navigate('Book')` with no params still opens the general composer.
 */
export type BookParams = {
  serviceId?: string;
  serviceName?: string;
  unit?: PricingUnit;
  kind?: ItemKind;
  preselectSiteId?: string;
  /**
   * [Inc-38] The tapped card's `ServiceCategory` id, and how many garments the founder nested under it.
   * `garmentCount > 0` ⇒ Book drills into the garment picker (priced per garment: a $5 shirt and a $15 coat
   * cost differently) and fetches that card's garments with `cardId`. Both additive — Book without them is
   * unchanged (the Inc-36 one-measure flow).
   */
  cardId?: string;
  garmentCount?: number;
};

/** The signed-in navigation stack (PRD §7A customer flows). */
export type RootStackParamList = {
  /** [Inc-37] The Home tab — the landing dashboard (what's new · my orders · my account + credit). */
  Home: undefined;
  /** [Inc-36] The Services tab (the catalogue grid). Booking ALWAYS starts from a service card, so the
   *  "book something" CTAs elsewhere send the customer here to pick one, never to a general composer. */
  Services: undefined;
  /** [Inc-37] The Refer tab. Typed here (it was tab-only) because Home's block CTAs now navigate to it. */
  Refer: undefined;
  Orders: undefined;
  /** [Royal] Read-only per-garment dry-cleaning price catalogue. Net-new route — additive, nothing frozen
   *  changes shape; existing screens keep resolving exactly as before. */
  Pricing: undefined;
  Book: BookParams | undefined;
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Chat: { orderId: string };
  Pay: { orderId: string };
  /** [Inc-32] Rate a delivered order (1–5 + optional comment). Additive — existing param shapes unchanged. */
  Rate: { orderId: string };
  Settings: undefined;
  /** [Inc-26] Manage saved addresses (reached from Settings). */
  Addresses: undefined;
  /** [Inc-26] Add (no `siteId`) or edit (with `siteId`). `returnTo: 'Book'` hands the new id back to Book. */
  AddressForm: { siteId?: string; returnTo?: 'Book' } | undefined;
};

/** A ref so out-of-tree code (a tapped push) can deep-link into the stack. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Deep-link to an order's live tracking (the push-tap target). Scoped: the screen reads the order
 *  through the row-scoped API, so a non-owned id simply 404s. */
export function openOrderTracking(orderId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('Track', { orderId });
  }
}
