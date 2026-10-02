/**
 * Sports and record distances (PLAN.md 1 and 4.1). The distance list is configuration:
 * the records engine and the UI iterate over it instead of hard-coding targets.
 */

export const SPORTS = ['road_run', 'trail_run', 'xc_ski'] as const;
export type Sport = (typeof SPORTS)[number];

export const DISTANCE_KEYS = ['1k', '5k', '10k', 'hm'] as const;
export type DistanceKey = (typeof DISTANCE_KEYS)[number];

export type DistanceConfig = { key: DistanceKey; targetM: number };

export const DISTANCES: Readonly<Record<DistanceKey, DistanceConfig>> = {
  '1k': { key: '1k', targetM: 1000 },
  '5k': { key: '5k', targetM: 5000 },
  '10k': { key: '10k', targetM: 10000 },
  hm: { key: 'hm', targetM: 21097.5 },
};

export type SportConfig = {
  code: Sport;
  /** Disabled sports are kept in the data model but hidden in the UI. */
  enabled: boolean;
  /** Record distances, shortest first. */
  distanceKeys: readonly DistanceKey[];
  /** Elevation gain matters for this sport (shown in the races view). */
  tracksElevation: boolean;
};

export const SPORT_CONFIG: Readonly<Record<Sport, SportConfig>> = {
  road_run: {
    code: 'road_run',
    enabled: true,
    distanceKeys: ['1k', '5k', '10k', 'hm'],
    tracksElevation: false,
  },
  trail_run: {
    code: 'trail_run',
    enabled: true,
    distanceKeys: ['1k', '5k', '10k', 'hm'],
    tracksElevation: true,
  },
  // Not in the MVP: the distances will be settled when cross-country skiing is enabled.
  xc_ski: {
    code: 'xc_ski',
    enabled: false,
    distanceKeys: ['5k', '10k'],
    tracksElevation: true,
  },
};

/** Sports shown in the UI, in display order. */
export const ENABLED_SPORTS: readonly Sport[] = SPORTS.filter((s) => SPORT_CONFIG[s].enabled);

/** Distances of a sport with their targets, shortest first. */
export function sportDistances(sport: Sport): DistanceConfig[] {
  return SPORT_CONFIG[sport].distanceKeys.map((key) => DISTANCES[key]);
}

/** Relative distance tolerance (10%), applied only to targets above 1 km. */
export const TOLERANCE_RATIO = 0.1;
const TOLERANCE_ABOVE_M = 1000;

/** True when the 10% tolerance applies to the target (targets > 1 km). */
export function toleranceApplies(targetM: number): boolean {
  return targetM > TOLERANCE_ABOVE_M;
}

/** Rounds metres to the storage precision (0.1 m), which also hides float noise. */
export function roundMetres(m: number): number {
  return Math.round(m * 10) / 10;
}

/** Shortest activity distance that can give a result for the target. */
export function minQualifyingDistanceM(targetM: number): number {
  return toleranceApplies(targetM) ? roundMetres(targetM * (1 - TOLERANCE_RATIO)) : targetM;
}

/** True when an activity of `distanceM` can give a result for the target (PLAN.md 4.1). */
export function qualifiesForTarget(distanceM: number, targetM: number): boolean {
  return distanceM >= minQualifyingDistanceM(targetM);
}
