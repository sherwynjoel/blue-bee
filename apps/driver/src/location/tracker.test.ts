import * as tracker from './tracker';
import type { ApiClient } from '../api/client';

// The native expo-location/task-manager modules are mocked in jest.setup.js (granted permissions,
// no-op task registration), so this exercises the REAL gating + flush logic against a fake API client.
const fakeClient = { postLocations: jest.fn(async () => ({})) } as unknown as ApiClient;

afterEach(async () => {
  (fakeClient.postLocations as jest.Mock).mockClear();
  await tracker.stopTracking();
});

describe('location tracker gating (US-T5 / §6.2)', () => {
  it('does NOT emit before a shift is active', async () => {
    await tracker.ingestFixes([{ latitude: 43.7, longitude: -79.4, timestampMs: 1_700_000_000_000 }]);
    expect(fakeClient.postLocations).not.toHaveBeenCalled();
    expect(tracker.pendingPingCount()).toBe(0);
  });

  it('emits to /locations:batch once a shift is active, and stops on shift end', async () => {
    const started = await tracker.startTracking(fakeClient, 'shift-1', 'veh-1');
    expect(started).toBe(true);
    expect(tracker.isTracking()).toBe(true);

    await tracker.ingestFixes([{ latitude: 43.7, longitude: -79.4, speed: -1, heading: -1, timestampMs: 1_700_000_000_000 }]);
    expect(fakeClient.postLocations).toHaveBeenCalledTimes(1);
    const batch = (fakeClient.postLocations as jest.Mock).mock.calls[0][0];
    expect(batch.shiftId).toBe('shift-1');
    expect(batch.vehicleId).toBe('veh-1');
    expect(batch.pings[0]).toMatchObject({ lat: 43.7, lng: -79.4 });
    expect(batch.pings[0].speed).toBeUndefined(); // -1 dropped

    await tracker.stopTracking();
    expect(tracker.isTracking()).toBe(false);
    (fakeClient.postLocations as jest.Mock).mockClear();
    await tracker.ingestFixes([{ latitude: 1, longitude: 2, timestampMs: 1_700_000_100_000 }]);
    expect(fakeClient.postLocations).not.toHaveBeenCalled(); // gated again after shift end
  });
});
