/** The in-app target a tapped push resolves to (always an order's detail this phase). */
export interface PushDeepLinkTarget {
  screen: 'OrderDetail';
  params: { orderId: string };
}

/**
 * Pure router for a tapped push's data payload (PRD §7C C4 "tap to drill into the underlying
 * object"). The Inc-8 engine attaches `{ orderId, type }` to every PUSH (the deep-link payload); an
 * owner exception/dispute alert carries the owning `orderId`, so we route to that order's detail.
 *
 * SCOPING: we only ever navigate to an order id; the OrderDetail screen reads it through the
 * OWNER-scoped API, so a non-owned / cross-org id simply 404s server-side (never a cross-tenant leak).
 * Returns null for an unroutable payload (no orderId) so the tap is a safe no-op.
 */
export function routeForPushData(data: unknown): PushDeepLinkTarget | null {
  if (!data || typeof data !== 'object') return null;
  const orderId = (data as Record<string, unknown>).orderId;
  if (typeof orderId !== 'string' || orderId.trim() === '') return null;
  return { screen: 'OrderDetail', params: { orderId: orderId.trim() } };
}
