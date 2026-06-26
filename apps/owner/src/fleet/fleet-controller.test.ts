import type { FleetLiveResult, LivePositionEvent } from '@blue-bee/shared';
import {
  FleetController,
  mergeFleet,
  type FleetDeps,
  type FleetSocketHandlers,
  type FleetState,
} from './fleet-controller';

const snapshot = (): FleetLiveResult => ({
  vehicles: [
    {
      vehicleId: 'v1',
      label: 'Van 1',
      lat: 43.7,
      lng: -79.4,
      speed: null,
      heading: 10,
      recordedAt: '2026-06-26T10:00:00.000Z',
      ageSeconds: 5,
      source: 'redis',
      nextStopEta: null,
    },
  ],
  withoutPosition: [{ vehicleId: 'v2', label: 'Van 2' }],
});

const pos = (over: Partial<LivePositionEvent> = {}): LivePositionEvent => ({
  vehicleId: 'v1',
  lat: 44.0,
  lng: -80.0,
  speed: null,
  heading: 90,
  recordedAt: '2026-06-26T10:01:00.000Z',
  ...over,
});

describe('mergeFleet (pure)', () => {
  it('overlays a live position (marks the vehicle live + uses the live coords)', () => {
    const merged = mergeFleet(snapshot(), { v1: pos() });
    const v1 = merged.find((v) => v.vehicleId === 'v1')!;
    expect(v1.live).toBe(true);
    expect(v1.lat).toBe(44.0);
    expect(v1.hasPosition).toBe(true);
  });

  it('keeps the REST snapshot when there is no live event, and includes idle vehicles', () => {
    const merged = mergeFleet(snapshot(), {});
    const v1 = merged.find((v) => v.vehicleId === 'v1')!;
    const v2 = merged.find((v) => v.vehicleId === 'v2')!;
    expect(v1.live).toBe(false);
    expect(v1.lat).toBe(43.7);
    expect(v2.hasPosition).toBe(false); // idle (no position yet)
  });
});

function harness(fetchFleet: () => Promise<FleetLiveResult>) {
  let handlers: FleetSocketHandlers | null = null;
  let last: FleetState | null = null;
  let connectCalled = false;
  const disconnect = jest.fn();
  const fetchSpy = jest.fn(fetchFleet);
  const deps: FleetDeps = {
    fetchFleet: fetchSpy,
    connect: (h) => {
      connectCalled = true;
      handlers = h;
      return { disconnect };
    },
    onState: (s) => {
      last = s;
    },
  };
  return { deps, getHandlers: () => handlers!, last: () => last!, fetchSpy, disconnect, connectCalled: () => connectCalled };
}

describe('FleetController (REST truth, WS optimisation, degrade)', () => {
  it('start → REST snapshot then a connected socket goes live; a position refines the pin', async () => {
    const h = harness(async () => snapshot());
    const ctrl = new FleetController(h.deps);
    await ctrl.start();

    expect(h.last().vehicles).toHaveLength(2);
    expect(h.last().idleCount).toBe(1);
    expect(h.last().phase).toBe('connecting'); // snapshot painted, socket opening

    h.getHandlers().onConnect();
    expect(h.last().phase).toBe('live');

    h.getHandlers().onPosition(pos({ lat: 45.5 }));
    const v1 = h.last().vehicles.find((v) => v.vehicleId === 'v1')!;
    expect(v1.live).toBe(true);
    expect(v1.lat).toBe(45.5);
  });

  it('a socket drop degrades (never blank) and re-polls REST — WS is not the source of truth', async () => {
    const h = harness(async () => snapshot());
    const ctrl = new FleetController(h.deps);
    await ctrl.start();
    h.getHandlers().onConnect();
    h.fetchSpy.mockClear();

    h.getHandlers().onDisconnect('transport close');
    expect(h.last().phase).toBe('degraded');
    expect(h.last().vehicles).toHaveLength(2); // last snapshot retained, not blanked
    await Promise.resolve();
    expect(h.fetchSpy).toHaveBeenCalled(); // re-polled REST
  });

  it('a fetch failure with no prior data → error (and the socket is never opened)', async () => {
    const h = harness(async () => {
      throw new Error('network down');
    });
    const ctrl = new FleetController(h.deps);
    await ctrl.start();
    expect(h.last().phase).toBe('error');
    expect(h.connectCalled()).toBe(false); // the socket is never opened when the snapshot failed
  });
});
