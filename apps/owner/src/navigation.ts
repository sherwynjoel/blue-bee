import { createNavigationContainerRef } from '@react-navigation/native';

/** The signed-in navigation stack (PRD §7C owner cockpit). */
export type RootStackParamList = {
  Dashboard: undefined;
  Fleet: undefined;
  Approvals: undefined;
  Exceptions: undefined;
  OrderDetail: { orderId: string };
  RouteDetail: { routeId: string; title?: string };
};

/** A ref so out-of-tree code (a tapped push) can deep-link into the stack. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Deep-link to an order's detail (the push-tap target). Scoped: the screen reads the order through
 *  the OWNER-scoped API, so a non-owned / cross-org id simply 404s (server-authoritative). */
export function openOrderDetail(orderId: string): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('OrderDetail', { orderId });
  }
}
