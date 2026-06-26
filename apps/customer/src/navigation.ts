import { createNavigationContainerRef } from '@react-navigation/native';

/** The signed-in navigation stack (PRD §7A customer flows). */
export type RootStackParamList = {
  Orders: undefined;
  Book: undefined;
  OrderDetail: { orderId: string };
  Track: { orderId: string };
  Pay: { orderId: string };
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
