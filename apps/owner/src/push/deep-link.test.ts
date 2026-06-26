import { routeForPushData } from './deep-link';

describe('routeForPushData (push deep-link router, scoped)', () => {
  it('routes a dispute/exception push (carries orderId) to the order detail', () => {
    const target = routeForPushData({ orderId: 'order-123', type: 'payment.dispute' });
    expect(target).toEqual({ screen: 'OrderDetail', params: { orderId: 'order-123' } });
  });

  it('routes any owner push that carries an orderId, regardless of type', () => {
    expect(routeForPushData({ orderId: 'o9', type: 'whatever' })?.params.orderId).toBe('o9');
  });

  it('is a safe no-op (null) for an unroutable payload', () => {
    expect(routeForPushData({ type: 'payment.dispute' })).toBeNull(); // no orderId
    expect(routeForPushData({ orderId: '' })).toBeNull(); // empty
    expect(routeForPushData({ orderId: 42 })).toBeNull(); // wrong type
    expect(routeForPushData(null)).toBeNull();
    expect(routeForPushData('nope')).toBeNull();
  });

  it('trims the orderId', () => {
    expect(routeForPushData({ orderId: '  o1  ' })?.params.orderId).toBe('o1');
  });
});
