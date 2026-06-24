import type { Server } from 'socket.io';
import { WS_EVENTS, WS_NAMESPACES, type LivePositionEvent } from '@blue-bee/shared';
import { RealtimePublisher } from './realtime-publisher.service';

interface Call {
  ns: string;
  room: string;
  op: 'emit' | 'disconnect';
  event?: string;
  payload?: unknown;
}

/** A minimal Socket.IO Server stand-in that records emit/disconnect targeting. */
function fakeServer(): { server: Server; calls: Call[] } {
  const calls: Call[] = [];
  const of = (ns: string) => ({
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        calls.push({ ns, room, op: 'emit', event, payload });
        return true;
      },
    }),
    in: (room: string) => ({
      disconnectSockets: async (_close?: boolean) => {
        calls.push({ ns, room, op: 'disconnect' });
      },
    }),
  });
  return { server: { of } as unknown as Server, calls };
}

const POS: LivePositionEvent = { vehicleId: 'v1', lat: 43.6, lng: -79.4, speed: 10, heading: 90, recordedAt: '2026-06-24T10:00:00.000Z' };

describe('RealtimePublisher — fan-out targeting + readiness gating', () => {
  it('is not ready and no-ops before a server is bound (REST stays source of truth)', () => {
    const pub = new RealtimePublisher();
    expect(pub.isReady()).toBe(false);
    expect(() => pub.publishPosition('org-1', 'v1', POS)).not.toThrow(); // no server → silent no-op
  });

  it('publishes a position to BOTH the org vehicle room and the org fleet room', () => {
    const pub = new RealtimePublisher();
    const { server, calls } = fakeServer();
    pub.bindServer(server);
    expect(pub.isReady()).toBe(true);

    pub.publishPosition('org-1', 'v1', POS);

    expect(calls).toEqual([
      { ns: WS_NAMESPACES.VEHICLE, room: 'org:org-1:veh:v1', op: 'emit', event: WS_EVENTS.POSITION, payload: POS },
      { ns: WS_NAMESPACES.FLEET, room: 'org:org-1:fleet', op: 'emit', event: WS_EVENTS.POSITION, payload: POS },
    ]);
  });

  it('rooms are namespaced by org so tenants cannot collide', () => {
    const pub = new RealtimePublisher();
    expect(pub.vehicleRoom('A', 'v')).toBe('org:A:veh:v');
    expect(pub.vehicleRoom('B', 'v')).toBe('org:B:veh:v');
    expect(pub.fleetRoom('A')).not.toBe(pub.fleetRoom('B'));
    expect(pub.stopRoom('A', 's')).toBe('org:A:stop:s');
  });

  it('closeStopChannel emits channel:closed then force-disconnects the stop room', async () => {
    const pub = new RealtimePublisher();
    const { server, calls } = fakeServer();
    pub.bindServer(server);

    await pub.closeStopChannel('org-1', 'stop-1', 'v1', 'stop_completed');

    expect(calls[0]).toMatchObject({ ns: WS_NAMESPACES.VEHICLE, room: 'org:org-1:stop:stop-1', op: 'emit', event: WS_EVENTS.CHANNEL_CLOSED });
    expect(calls[0].payload).toEqual({ reason: 'stop_completed', vehicleId: 'v1', stopId: 'stop-1' });
    expect(calls[1]).toEqual({ ns: WS_NAMESPACES.VEHICLE, room: 'org:org-1:stop:stop-1', op: 'disconnect' });
  });

  it('closeVehicleChannel tears down the whole vehicle room on shift end', async () => {
    const pub = new RealtimePublisher();
    const { server, calls } = fakeServer();
    pub.bindServer(server);

    await pub.closeVehicleChannel('org-1', 'v1', 'shift_ended');

    expect(calls[0]).toMatchObject({ room: 'org:org-1:veh:v1', op: 'emit', event: WS_EVENTS.CHANNEL_CLOSED });
    expect(calls[1]).toEqual({ ns: WS_NAMESPACES.VEHICLE, room: 'org:org-1:veh:v1', op: 'disconnect' });
  });
});
