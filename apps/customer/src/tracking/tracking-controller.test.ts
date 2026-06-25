import type { OrderTrackingResult } from '@blue-bee/shared';
import { TrackingController, type SocketHandlers, type SocketLike, type TrackingState } from './tracking-controller';

const flush = () => new Promise((r) => setImmediate(r));

function lastKnown(over: Partial<OrderTrackingResult['vehicle']> = {}): OrderTrackingResult['vehicle'] {
  return { vehicleId: 'v1', lat: 43.7, lng: -79.4, speed: null, heading: null, recordedAt: '2026-06-25T12:00:00.000Z', ageSeconds: 5, source: 'redis', ...over } as OrderTrackingResult['vehicle'];
}

function tracking(over: Partial<OrderTrackingResult> = {}): OrderTrackingResult {
  return {
    orderId: 'o1',
    stop: { id: 's1', status: 'EN_ROUTE', kind: 'PICKUP', eta: '2026-06-25T12:30:00.000Z', etaLow: '2026-06-25T12:25:00.000Z', etaHigh: '2026-06-25T12:40:00.000Z', etaComputedAt: '2026-06-25T12:00:00.000Z' },
    vehicle: lastKnown(),
    channelToken: 'tok-1',
    ...over,
  };
}

/** A test harness: a queue of tracking responses + a captured fake socket per connect. */
function harness(responses: OrderTrackingResult[]) {
  const fetchCalls: number[] = [];
  let i = 0;
  const connects: { token: string; handlers: SocketHandlers; socket: SocketLike & { disconnected: boolean } }[] = [];
  const states: TrackingState[] = [];

  const fetchTracking = jest.fn(async () => {
    fetchCalls.push(Date.now());
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r!;
  });

  const connect = jest.fn((token: string, handlers: SocketHandlers): SocketLike => {
    const socket = { disconnected: false, disconnect: jest.fn(() => { socket.disconnected = true; }) };
    connects.push({ token, handlers, socket });
    return socket;
  });

  const controller = new TrackingController({ fetchTracking, connect, onState: (s) => states.push(s) });
  const last = () => states[states.length - 1]!;
  const current = () => connects[connects.length - 1]!;
  return { controller, fetchTracking, connect, connects, states, last, current };
}

describe('TrackingController (REST-truth / WS-optimisation §12.3)', () => {
  it('paints from REST first, then connects the live channel and goes live on connect', async () => {
    const h = harness([tracking()]);
    await h.controller.start();
    // REST snapshot painted before the socket connects (source rest, vehicle present).
    expect(h.last().vehicle?.lat).toBe(43.7);
    expect(h.last().source).toBe('rest');
    expect(h.connect).toHaveBeenCalledWith('tok-1', expect.anything());
    h.current().handlers.onConnect();
    expect(h.last().phase).toBe('live');
  });

  it('a live position event moves the truck (source live)', async () => {
    const h = harness([tracking()]);
    await h.controller.start();
    h.current().handlers.onConnect();
    h.current().handlers.onPosition({ vehicleId: 'v1', lat: 43.8, lng: -79.5, speed: 10, heading: 90, recordedAt: '2026-06-25T12:05:00.000Z' });
    expect(h.last().vehicle?.lat).toBe(43.8);
    expect(h.last().source).toBe('live');
  });

  it('an eta event refreshes the ETA range; geofence sets approaching/arrived', async () => {
    const h = harness([tracking()]);
    await h.controller.start();
    h.current().handlers.onEta({ stopId: 's1', eta: 'E', low: 'L', high: 'H', etaSeconds: 120, computedAt: 'C', vehicleId: 'v1', orderId: 'o1' });
    expect(h.last().eta).toEqual({ eta: 'E', low: 'L', high: 'H', computedAt: 'C' });
    h.current().handlers.onGeofence({ vehicleId: 'v1', stopId: 's1', orderId: 'o1', type: 'APPROACHING', occurredAt: 'O' });
    expect(h.last().approaching).toBe(true);
    h.current().handlers.onGeofence({ vehicleId: 'v1', stopId: 's1', orderId: 'o1', type: 'ARRIVED', occurredAt: 'O' });
    expect(h.last().arrived).toBe(true);
  });

  it('no active stop / no token → REST phase, never connects a socket', async () => {
    const h = harness([tracking({ stop: null, vehicle: null, channelToken: null })]);
    await h.controller.start();
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.last().phase).toBe('rest');
  });

  it('token_expired channel:closed → re-fetch a FRESH token and reconnect', async () => {
    const h = harness([tracking({ channelToken: 'tok-1' }), tracking({ channelToken: 'tok-2' })]);
    await h.controller.start();
    h.current().handlers.onConnect();
    const first = h.current();
    first.handlers.onChannelClosed({ reason: 'token_expired', vehicleId: 'v1', stopId: 's1' });
    await flush();
    expect(first.socket.disconnect).toHaveBeenCalled(); // old socket torn down
    expect(h.fetchTracking).toHaveBeenCalledTimes(2); // re-fetched for a fresh token
    expect(h.connect).toHaveBeenLastCalledWith('tok-2', expect.anything()); // reconnected with the new token
  });

  it('channel:closed{stop_completed} with no new stop → degrade to REST + timeline (no socket)', async () => {
    const h = harness([tracking({ channelToken: 'tok-1' }), tracking({ stop: null, vehicle: lastKnown({ lat: 43.9 }), channelToken: null })]);
    await h.controller.start();
    h.current().handlers.onConnect();
    h.current().handlers.onChannelClosed({ reason: 'stop_completed', vehicleId: 'v1', stopId: 's1' });
    await flush();
    expect(h.last().phase).toBe('rest'); // REST source of truth, no live channel
    expect(h.connect).toHaveBeenCalledTimes(1); // did NOT reconnect (no token)
    expect(h.last().vehicle?.lat).toBe(43.9); // last-known still shown — never blank
  });

  it('channel:closed{stop_reassigned} with a new active stop → reconnect to the new stop', async () => {
    const h = harness([
      tracking({ channelToken: 'tok-1', stop: { id: 's1', status: 'EN_ROUTE', kind: 'PICKUP', eta: null, etaLow: null, etaHigh: null, etaComputedAt: null } }),
      tracking({ channelToken: 'tok-9', stop: { id: 's2', status: 'EN_ROUTE', kind: 'DELIVERY', eta: null, etaLow: null, etaHigh: null, etaComputedAt: null } }),
    ]);
    await h.controller.start();
    h.current().handlers.onConnect();
    h.current().handlers.onChannelClosed({ reason: 'stop_reassigned', vehicleId: 'v1', stopId: 's1' });
    await flush();
    expect(h.connect).toHaveBeenLastCalledWith('tok-9', expect.anything());
    expect(h.last().stop?.id).toBe('s2');
  });

  it('connect_error (stop_not_active live re-check) → re-fetch + reconnect once', async () => {
    const h = harness([tracking({ channelToken: 'tok-1' }), tracking({ channelToken: 'tok-2' })]);
    await h.controller.start();
    h.current().handlers.onConnectError({ message: 'stop_not_active', data: { code: 'stop_not_active' } });
    await flush();
    expect(h.connect).toHaveBeenLastCalledWith('tok-2', expect.anything());
  });

  it('repeated connect_error eventually stops retrying and stays on REST (no infinite loop)', async () => {
    // every fetch returns a token, but every connect "fails" — bounded by MAX_CONNECT_ATTEMPTS.
    const h = harness([tracking(), tracking(), tracking(), tracking(), tracking(), tracking()]);
    await h.controller.start();
    for (let n = 0; n < 6; n++) {
      const c = h.current();
      c.handlers.onConnectError({ message: 'stop_not_active' });
      await flush();
    }
    // It gave up the live channel rather than reconnecting forever.
    expect(h.last().phase === 'rest' || h.last().phase === 'degraded').toBe(true);
    expect(h.connect.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('transport disconnect → degraded (socket NOT torn down so it can auto-reconnect) + REST refresh', async () => {
    const h = harness([tracking(), tracking({ vehicle: lastKnown({ lat: 44.0 }) })]);
    await h.controller.start();
    h.current().handlers.onConnect();
    const sock = h.current().socket;
    h.current().handlers.onDisconnect('transport close');
    await flush();
    expect(h.last().phase).toBe('degraded');
    expect(sock.disconnect).not.toHaveBeenCalled(); // left alone for socket.io auto-reconnect
    expect(h.last().vehicle?.lat).toBe(44.0); // REST last-known refreshed — never blank
  });

  it('REST fetch failure on start with no prior data → error (never blank), retry recovers', async () => {
    const fetchTracking = jest
      .fn<Promise<OrderTrackingResult>, []>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(tracking());
    const states: TrackingState[] = [];
    const connect = jest.fn((_t: string, _h: SocketHandlers): SocketLike => ({ disconnect: jest.fn() }));
    const controller = new TrackingController({ fetchTracking, connect, onState: (s) => states.push(s) });
    await controller.start();
    expect(states[states.length - 1]!.phase).toBe('error');
    await controller.retry();
    expect(states[states.length - 1]!.phase).not.toBe('error'); // recovered to a real snapshot
  });

  it('privacy: the ONLY data source is this order’s tracking read (never a fleet call)', async () => {
    const h = harness([tracking()]);
    await h.controller.start();
    h.current().handlers.onConnect();
    // The controller has exactly one injected data source (fetchTracking) + connect(token). It never
    // reaches for anything else — connect always gets the token minted by THIS order's tracking read.
    expect(h.connect).toHaveBeenCalledWith('tok-1', expect.anything());
    expect(h.fetchTracking).toHaveBeenCalledTimes(1);
  });

  it('stop() tears down the socket and stops emitting', async () => {
    const h = harness([tracking()]);
    await h.controller.start();
    const sock = h.current().socket;
    const before = h.states.length;
    h.controller.stop();
    expect(sock.disconnect).toHaveBeenCalled();
    // a late event after stop must not emit new state
    h.current().handlers.onPosition({ vehicleId: 'v1', lat: 1, lng: 2, speed: null, heading: null, recordedAt: 'x' });
    expect(h.states.length).toBe(before);
  });
});
