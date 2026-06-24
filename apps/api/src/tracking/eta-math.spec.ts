import type { EtaConfig } from '../config/tracking.config';
import { computeEta, deriveSpeedKmh, haversineMeters, resolveSpeedKmh, type TrackPoint } from './eta-math';

/** Baseline config for the math tests (mirrors the .env defaults; overridden per-case as needed). */
const CFG: EtaConfig = {
  circuityFactor: 1.3,
  defaultSpeedKmh: 30,
  speedFloorKmh: 5,
  speedCeilKmh: 90,
  smoothingAlpha: 0.5,
  rangePct: 0.2,
  maxEtaSeconds: 14_400,
  recentPingSampleSize: 5,
  minMovementMeters: 15,
  recomputeMinIntervalSec: 0,
};

describe('eta-math (Increment 7 — pure ETA brain)', () => {
  describe('haversineMeters', () => {
    it('returns 0 for the same point', () => {
      expect(haversineMeters({ lat: 43.7, lng: -79.4 }, { lat: 43.7, lng: -79.4 })).toBe(0);
    });

    it('≈111 km for 1° of latitude', () => {
      const d = haversineMeters({ lat: 43, lng: -79 }, { lat: 44, lng: -79 });
      expect(d).toBeGreaterThan(111_000);
      expect(d).toBeLessThan(111_400);
    });
  });

  describe('deriveSpeedKmh', () => {
    const at = (lat: number, lng: number, sec: number): TrackPoint => ({ lat, lng, recordedAtMs: sec * 1000 });

    it('null for fewer than 2 points (first ping)', () => {
      expect(deriveSpeedKmh([at(43.7, -79.4, 0)], 15)).toBeNull();
    });

    it('null when total movement is below the noise floor (stationary)', () => {
      // two points ~1 m apart over 10 s → below the 15 m floor → fallback
      expect(deriveSpeedKmh([at(43.70000, -79.4, 0), at(43.70001, -79.4, 10)], 15)).toBeNull();
    });

    it('null when all points share an instant (no time base)', () => {
      expect(deriveSpeedKmh([at(43.70, -79.4, 5), at(43.80, -79.4, 5)], 15)).toBeNull();
    });

    it('derives ~36 km/h from 100 m over 10 s', () => {
      // 0.0008983° lat ≈ 100 m; over 10 s → 10 m/s → 36 km/h
      const v = deriveSpeedKmh([at(43.7, -79.4, 0), at(43.7 + 0.0008983, -79.4, 10)], 15);
      expect(v).not.toBeNull();
      expect(v as number).toBeGreaterThan(34);
      expect(v as number).toBeLessThan(38);
    });

    it('sums consecutive segments over the full window', () => {
      const pts = [at(43.7, -79.4, 0), at(43.7 + 0.0008983, -79.4, 10), at(43.7 + 2 * 0.0008983, -79.4, 20)];
      const v = deriveSpeedKmh(pts, 15) as number; // 200 m over 20 s → 36 km/h
      expect(v).toBeGreaterThan(34);
      expect(v).toBeLessThan(38);
    });
  });

  describe('resolveSpeedKmh', () => {
    it('falls back to the urban average when no speed could be derived', () => {
      expect(resolveSpeedKmh(null, CFG)).toEqual({ speedKmh: 30, method: 'default-speed' });
    });
    it('passes a within-bounds derived speed through', () => {
      expect(resolveSpeedKmh(42, CFG)).toEqual({ speedKmh: 42, method: 'derived' });
    });
    it('clamps a crawling speed up to the floor', () => {
      expect(resolveSpeedKmh(2, CFG)).toEqual({ speedKmh: 5, method: 'derived' });
    });
    it('clamps a GPS-jump speed down to the ceiling', () => {
      expect(resolveSpeedKmh(500, CFG)).toEqual({ speedKmh: 90, method: 'derived' });
    });
  });

  describe('computeEta', () => {
    it('distance × circuity ÷ speed (first compute, no smoothing memory)', () => {
      // 1000 m × 1.3 ÷ (36 km/h = 10 m/s) = 130 s
      const r = computeEta({ distanceMeters: 1000, speedKmh: 36, cfg: CFG, prevTargetMs: null, computeNowMs: 0 });
      expect(r.etaSeconds).toBeCloseTo(130, 5);
    });

    it('surfaces a ± rangePct range around the mid', () => {
      const r = computeEta({ distanceMeters: 1000, speedKmh: 36, cfg: CFG, prevTargetMs: null, computeNowMs: 0 });
      expect(r.lowSeconds).toBeCloseTo(104, 5); // 130 × 0.8
      expect(r.highSeconds).toBeCloseTo(156, 5); // 130 × 1.2
    });

    it('EWMA-blends against the aged prior estimate', () => {
      // prior target was 200 s out, computed at t=0; now t=10 s ⇒ aged prior remaining = 190 s.
      // fresh raw = 1000 m × 1 ÷ 10 m/s = 100 s ⇒ mid = 0.5·100 + 0.5·190 = 145 s.
      const cfg = { ...CFG, circuityFactor: 1.0 };
      const r = computeEta({ distanceMeters: 1000, speedKmh: 36, cfg, prevTargetMs: 200_000, computeNowMs: 10_000 });
      expect(r.etaSeconds).toBeCloseTo(145, 5);
    });

    it('caps the mid AND the high at maxEtaSeconds (no unbounded ETA)', () => {
      const r = computeEta({ distanceMeters: 1e9, speedKmh: 5, cfg: CFG, prevTargetMs: null, computeNowMs: 0 });
      expect(r.etaSeconds).toBe(CFG.maxEtaSeconds);
      expect(r.highSeconds).toBe(CFG.maxEtaSeconds);
    });

    it('floors a negative/overdue blend at 0 (never negative)', () => {
      // prior target already in the past (overdue) + ~0 distance ⇒ mid floored at 0.
      const r = computeEta({ distanceMeters: 0, speedKmh: 30, cfg: CFG, prevTargetMs: -5000, computeNowMs: 0 });
      expect(r.etaSeconds).toBe(0);
      expect(r.lowSeconds).toBe(0);
    });

    it('shrinks monotonically as the vehicle approaches (distance falls, prior ages)', () => {
      const cfg = { ...CFG, circuityFactor: 1.0 };
      // step 1: 3000 m, no memory
      const s1 = computeEta({ distanceMeters: 3000, speedKmh: 36, cfg, prevTargetMs: null, computeNowMs: 0 });
      const target1 = 0 + s1.etaSeconds * 1000;
      // step 2: 2000 m, 5 s later
      const s2 = computeEta({ distanceMeters: 2000, speedKmh: 36, cfg, prevTargetMs: target1, computeNowMs: 5_000 });
      const target2 = 5_000 + s2.etaSeconds * 1000;
      // step 3: 1000 m, another 5 s later
      const s3 = computeEta({ distanceMeters: 1000, speedKmh: 36, cfg, prevTargetMs: target2, computeNowMs: 10_000 });
      expect(s2.etaSeconds).toBeLessThan(s1.etaSeconds);
      expect(s3.etaSeconds).toBeLessThan(s2.etaSeconds);
    });
  });
});
