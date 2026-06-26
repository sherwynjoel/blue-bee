import { GARMENT_TRANSITIONS, GarmentStatus, bucketForGarment, canTransitionGarment } from '@blue-bee/shared';

/**
 * Garment lifecycle (PRD §5.2-B) — the pure transition guard + the A4.2 bucketing. Server-authoritative
 * logic, unit-tested headlessly so the e2e only has to prove the wiring, not the rules.
 */
describe('garment lifecycle (§5.2-B)', () => {
  it('allows the linear path enrolled → … → delivered', () => {
    expect(canTransitionGarment(GarmentStatus.GARMENT_ENROLLED, GarmentStatus.SOIL_PICKUP)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.SOIL_PICKUP, GarmentStatus.INTAKE_SORT)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.INTAKE_SORT, GarmentStatus.WASH)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.WASH, GarmentStatus.RETURN_SORT)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.RETURN_SORT, GarmentStatus.DELIVERED_TO_RESIDENT)).toBe(true);
  });

  it('allows the odd-item branch (return-sort → lost&found → reconcile → delivered)', () => {
    expect(canTransitionGarment(GarmentStatus.RETURN_SORT, GarmentStatus.LOST_FOUND_POOL)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.LOST_FOUND_POOL, GarmentStatus.RECONCILE)).toBe(true);
    expect(canTransitionGarment(GarmentStatus.RECONCILE, GarmentStatus.DELIVERED_TO_RESIDENT)).toBe(true);
  });

  it('re-opens the next recurring cycle from delivered', () => {
    expect(canTransitionGarment(GarmentStatus.DELIVERED_TO_RESIDENT, GarmentStatus.SOIL_PICKUP)).toBe(true);
  });

  it('rejects illegal jumps (no skipping stages, no going backwards)', () => {
    expect(canTransitionGarment(GarmentStatus.GARMENT_ENROLLED, GarmentStatus.WASH)).toBe(false);
    expect(canTransitionGarment(GarmentStatus.GARMENT_ENROLLED, GarmentStatus.DELIVERED_TO_RESIDENT)).toBe(false);
    expect(canTransitionGarment(GarmentStatus.WASH, GarmentStatus.GARMENT_ENROLLED)).toBe(false);
    expect(canTransitionGarment(GarmentStatus.INTAKE_SORT, GarmentStatus.LOST_FOUND_POOL)).toBe(false);
  });

  it('buckets each status for the A4.2 view', () => {
    expect(bucketForGarment(GarmentStatus.GARMENT_ENROLLED)).toBe('enrolled');
    expect(bucketForGarment(GarmentStatus.SOIL_PICKUP)).toBe('inProcess');
    expect(bucketForGarment(GarmentStatus.WASH)).toBe('inProcess');
    expect(bucketForGarment(GarmentStatus.RETURN_SORT)).toBe('inProcess');
    expect(bucketForGarment(GarmentStatus.RECONCILE)).toBe('inProcess');
    expect(bucketForGarment(GarmentStatus.DELIVERED_TO_RESIDENT)).toBe('returned');
    expect(bucketForGarment(GarmentStatus.LOST_FOUND_POOL)).toBe('lostFound');
  });

  it('maps every PRD §5.2-B state (no orphan / invented states)', () => {
    expect(Object.keys(GARMENT_TRANSITIONS).sort()).toEqual(Object.values(GarmentStatus).sort());
  });
});
