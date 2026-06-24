import { RouteStatus, RouteStopStatus } from '@blue-bee/shared';
import {
  dedupePings,
  newestPing,
  parseLastKnownHash,
  selectActiveStop,
  type SelectableStop,
} from './tracking-util';

describe('tracking-util — dedup + recorded_at-authoritative ordering', () => {
  it('dedupes by recorded_at instant (last wins) and sorts ascending regardless of arrival order', () => {
    const t1 = '2026-06-24T10:00:00.000Z';
    const t2 = '2026-06-24T10:00:05.000Z';
    const out = dedupePings([
      { lat: 1, lng: 1, recordedAt: t2 }, // out of order (newest first)
      { lat: 2, lng: 2, recordedAt: t1 },
      { lat: 9, lng: 9, recordedAt: t2 }, // duplicate instant — last wins
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].recordedAt.toISOString()).toBe(t1); // sorted ascending
    expect(out[1].recordedAt.toISOString()).toBe(t2);
    expect(out[1].lat).toBe(9); // the later duplicate superseded the earlier
  });

  it('defaults optional sensor fields (speed/heading) to null', () => {
    const [p] = dedupePings([{ lat: 1, lng: 1, recordedAt: '2026-06-24T10:00:00.000Z' }]);
    expect(p.speed).toBeNull();
    expect(p.heading).toBeNull();
  });

  it('newestPing returns the max recorded_at even when the list is unsorted', () => {
    const rows = dedupePings([
      { lat: 1, lng: 1, recordedAt: '2026-06-24T10:00:00.000Z' },
      { lat: 2, lng: 2, recordedAt: '2026-06-24T10:00:30.000Z' },
      { lat: 3, lng: 3, recordedAt: '2026-06-24T10:00:10.000Z' },
    ]);
    expect(newestPing(rows).recordedAt.toISOString()).toBe('2026-06-24T10:00:30.000Z');
    expect(newestPing(rows).lat).toBe(2);
  });
});

describe('tracking-util — selectActiveStop (privacy: exactly one vehicle)', () => {
  const stop = (status: string, seq: number, routeStatus: string, vehicleId: string | null): SelectableStop => ({
    status,
    seq,
    route: { status: routeStatus, vehicleId },
  });

  it('returns null when no stop is on a workable route', () => {
    expect(selectActiveStop([stop(RouteStopStatus.PENDING, 1, RouteStatus.PLANNED, 'v')])).toBeNull();
    expect(selectActiveStop([stop(RouteStopStatus.COMPLETED, 1, RouteStatus.COMPLETED, 'v')])).toBeNull();
  });

  it('returns null when all live-route stops are terminal', () => {
    expect(
      selectActiveStop([
        stop(RouteStopStatus.COMPLETED, 1, RouteStatus.IN_PROGRESS, 'v'),
        stop(RouteStopStatus.FAILED, 2, RouteStatus.IN_PROGRESS, 'v'),
        stop(RouteStopStatus.SKIPPED, 3, RouteStatus.PUBLISHED, 'v'),
      ]),
    ).toBeNull();
  });

  it('prefers the most-progressed stop (IN_PROGRESS > ARRIVED > EN_ROUTE > PENDING)', () => {
    const chosen = selectActiveStop([
      stop(RouteStopStatus.PENDING, 1, RouteStatus.IN_PROGRESS, 'v'),
      stop(RouteStopStatus.IN_PROGRESS, 5, RouteStatus.IN_PROGRESS, 'v'),
      stop(RouteStopStatus.EN_ROUTE, 2, RouteStatus.PUBLISHED, 'v'),
    ]);
    expect(chosen?.status).toBe(RouteStopStatus.IN_PROGRESS);
    expect(chosen?.seq).toBe(5);
  });

  it('tie-breaks equal-priority stops by sequence ascending', () => {
    const chosen = selectActiveStop([
      stop(RouteStopStatus.PENDING, 3, RouteStatus.PUBLISHED, 'v'),
      stop(RouteStopStatus.PENDING, 1, RouteStatus.PUBLISHED, 'v'),
      stop(RouteStopStatus.PENDING, 2, RouteStatus.PUBLISHED, 'v'),
    ]);
    expect(chosen?.seq).toBe(1);
  });
});

describe('tracking-util — parseLastKnownHash (freshness)', () => {
  const nowMs = Date.parse('2026-06-24T10:01:00.000Z');

  it('returns null for an absent/empty hash', () => {
    expect(parseLastKnownHash('v', null, nowMs)).toBeNull();
    expect(parseLastKnownHash('v', {}, nowMs)).toBeNull();
  });

  it('parses a full hash and computes ageSeconds from recordedAtMs', () => {
    const recordedAtMs = Date.parse('2026-06-24T10:00:00.000Z'); // 60s earlier
    const pos = parseLastKnownHash(
      'veh-1',
      {
        vehicleId: 'veh-1',
        lat: '43.65',
        lng: '-79.38',
        speed: '12.5',
        heading: '90',
        recordedAt: '2026-06-24T10:00:00.000Z',
        recordedAtMs: String(recordedAtMs),
      },
      nowMs,
    );
    expect(pos).toEqual({
      vehicleId: 'veh-1',
      lat: 43.65,
      lng: -79.38,
      speed: 12.5,
      heading: 90,
      recordedAt: '2026-06-24T10:00:00.000Z',
      ageSeconds: 60,
      source: 'redis',
    });
  });

  it('maps empty-string sensor fields to null', () => {
    const pos = parseLastKnownHash(
      'v',
      { lat: '1', lng: '2', speed: '', heading: '', recordedAt: 'x', recordedAtMs: String(nowMs) },
      nowMs,
    );
    expect(pos?.speed).toBeNull();
    expect(pos?.heading).toBeNull();
    expect(pos?.ageSeconds).toBe(0);
  });
});
