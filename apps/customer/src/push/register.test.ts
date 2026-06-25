import type { NotificationResponse } from 'expo-notifications';
import { extractOrderIdFromResponse } from './register';

function response(data: unknown): NotificationResponse {
  return { notification: { request: { content: { data } } } } as unknown as NotificationResponse;
}

describe('extractOrderIdFromResponse (push deep-link, scoped)', () => {
  it('pulls a string orderId from the push data', () => {
    expect(extractOrderIdFromResponse(response({ orderId: 'order-123', type: 'geofence.arrived' }))).toBe('order-123');
  });
  it('returns null when there is no orderId / not a string / no response', () => {
    expect(extractOrderIdFromResponse(response({}))).toBeNull();
    expect(extractOrderIdFromResponse(response({ orderId: 42 }))).toBeNull();
    expect(extractOrderIdFromResponse(response({ orderId: '' }))).toBeNull();
    expect(extractOrderIdFromResponse(null)).toBeNull();
    expect(extractOrderIdFromResponse(undefined)).toBeNull();
  });
});
