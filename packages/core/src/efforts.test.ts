import { describe, expect, it } from 'vitest';
import { effortFromTotals, effortsFromTotals, manualEffort } from './efforts';
import {
  ENABLED_SPORTS,
  minQualifyingDistanceM,
  qualifiesForTarget,
  sportDistances,
  toleranceApplies,
} from './sports';

describe('sports and distances', () => {
  it('hides cross-country skiing in the UI', () => {
    expect(ENABLED_SPORTS).toEqual(['road_run', 'trail_run']);
  });

  it('lists running distances shortest first', () => {
    expect(sportDistances('road_run').map((d) => [d.key, d.targetM])).toEqual([
      ['1k', 1000],
      ['5k', 5000],
      ['10k', 10000],
      ['hm', 21097.5],
    ]);
  });

  it('applies the 10% tolerance only above 1 km', () => {
    expect(toleranceApplies(1000)).toBe(false);
    expect(toleranceApplies(5000)).toBe(true);
    expect(minQualifyingDistanceM(1000)).toBe(1000);
    expect(minQualifyingDistanceM(5000)).toBe(4500);
    expect(minQualifyingDistanceM(21097.5)).toBe(18987.8);
    expect(qualifiesForTarget(4600, 5000)).toBe(true);
    expect(qualifiesForTarget(4499.9, 5000)).toBe(false);
    expect(qualifiesForTarget(999.9, 1000)).toBe(false);
  });
});

describe('effortFromTotals (no stream, PLAN.md Q8)', () => {
  it('gives a full result for exactly the target', () => {
    expect(effortFromTotals('5k', 5000, 1200)).toEqual({
      distanceKey: '5k',
      targetM: 5000,
      actualDistanceM: 5000,
      durationS: 1200,
      paceSPerKm: 240,
      isTolerance: false,
    });
  });

  it('scales the time to the target up to +1%', () => {
    const effort = effortFromTotals('5k', 5050, 1212)!;
    expect(effort).toMatchObject({ actualDistanceM: 5000, durationS: 1200, isTolerance: false });
    expect(effort.paceSPerKm).toBe(240);
    expect(effortFromTotals('1k', 1010, 202)).toMatchObject({ durationS: 200, isTolerance: false });
  });

  it('gives a tolerance result over the whole activity from -10% and above +1% up to +10%', () => {
    expect(effortFromTotals('5k', 4600, 1150)).toEqual({
      distanceKey: '5k',
      targetM: 5000,
      actualDistanceM: 4600,
      durationS: 1150,
      paceSPerKm: 250,
      isTolerance: true,
    });
    expect(effortFromTotals('5k', 4500, 1100)?.isTolerance).toBe(true);
    expect(effortFromTotals('5k', 5300, 1325)).toMatchObject({
      actualDistanceM: 5300,
      durationS: 1325,
      paceSPerKm: 250,
      isTolerance: true,
    });
    expect(effortFromTotals('5k', 5500, 1375)?.isTolerance).toBe(true);
  });

  it('gives nothing outside the tolerance', () => {
    expect(effortFromTotals('5k', 4499, 1100)).toBeNull();
    expect(effortFromTotals('5k', 5501, 1375)).toBeNull();
    expect(effortFromTotals('10k', 21097.5, 5400)).toBeNull();
  });

  it('has no tolerance for 1 km', () => {
    expect(effortFromTotals('1k', 950, 200)).toBeNull();
    expect(effortFromTotals('1k', 1050, 200)).toBeNull();
  });

  it('needs a positive duration and distance', () => {
    expect(effortFromTotals('5k', 5000, 0)).toBeNull();
    expect(effortFromTotals('5k', 0, 1200)).toBeNull();
  });
});

describe('effortsFromTotals', () => {
  it('returns one result per qualifying distance of the sport', () => {
    expect(effortsFromTotals('road_run', 21100, 5400).map((e) => e.distanceKey)).toEqual(['hm']);
    expect(effortsFromTotals('road_run', 9500, 2850).map((e) => e.distanceKey)).toEqual(['10k']);
    expect(effortsFromTotals('road_run', 7000, 2100)).toEqual([]);
  });

  it('returns nothing without a duration', () => {
    expect(effortsFromTotals('road_run', 5000, null)).toEqual([]);
  });
});

describe('manualEffort (simplified form)', () => {
  it('takes the time as the time over the target for longer activities', () => {
    expect(manualEffort('5k', 10000, 1200)).toEqual({
      distanceKey: '5k',
      targetM: 5000,
      actualDistanceM: 5000,
      durationS: 1200,
      paceSPerKm: 240,
      isTolerance: false,
    });
  });

  it('gives a tolerance result for activities shorter than the target', () => {
    expect(manualEffort('5k', 4600, 1150)).toMatchObject({
      actualDistanceM: 4600,
      paceSPerKm: 250,
      isTolerance: true,
    });
  });

  it('rejects activities too short for the target', () => {
    expect(manualEffort('5k', 4400, 1100)).toBeNull();
    expect(manualEffort('1k', 990, 200)).toBeNull();
  });
});
