import { createNavigationContainerRef } from '@react-navigation/native';
import type { ItemKind, PricingUnit } from '@blue-bee/shared';

/** The signed-in navigation stack (PRD §7A customer flows). */
export type RootStackParamList = {
  Orders: undefined;
  // [Inc-23] Optional card context — tapping a Home service card pre-selects its backing service in Book.
  // Additive: `navigation.navigate('Book')` with no params still opens the general composer.
  Book: { serviceId?: string; serviceName?: string; unit?: PricingUnit; kind?: ItemKind } | undefined;
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Chat: { orderId: string };
  Pay: { orderId: string };
  Settings: undefined;
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
