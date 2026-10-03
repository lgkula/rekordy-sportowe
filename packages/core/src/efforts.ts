import { paceSecondsPerKm } from './format';
import type { Stream } from './schemas';
import { fastestSegmentS, streamDistanceM } from './stream';
import {
  DISTANCES,
  qualifiesForTarget,
  roundMetres,
  sportDistances,
  TOLERANCE_RATIO,
  toleranceApplies,
  type DistanceKey,
  type Sport,
} from './sports';

/** A result on one record distance, before it is stored in `efforts`. */
export type EffortValues = {
  distanceKey: DistanceKey;
  targetM: number;
  /** Distance the time refers to: the target, or the activity distance for tolerance results. */
  actualDistanceM: number;
  durationS: number;
  paceSPerKm: number;
  /** Qualifies only through the distance tolerance: the UI shows pace, not time (D2). */
  isTolerance: boolean;
};

/**
 * Without a stream, a total slightly longer than the target still counts as covering exactly
 * the target (GPS measuring error), with the time scaled down to the target.
 */
export const FULL_RESULT_MARGIN_RATIO = 0.01;

function roundSeconds(s: number): number {
  return Math.round(s * 10) / 10;
}

function roundPace(s: number): number {
  return Math.round(s * 1000) / 1000;
}

function effort(
  distanceKey: DistanceKey,
  actualDistanceM: number,
  durationS: number,
  isTolerance: boolean,
): EffortValues {
  return {
    distanceKey,
    targetM: DISTANCES[distanceKey].targetM,
    actualDistanceM: roundMetres(actualDistanceM),
    durationS: roundSeconds(durationS),
    paceSPerKm: roundPace(paceSecondsPerKm(durationS, actualDistanceM)),
    isTolerance,
  };
}

/**
 * Result for one target from activity totals only, i.e. without a stream (PLAN.md Q8):
 * - `T ≤ d ≤ 1.01·T`: full result, time scaled to the target;
 * - `0.9·T ≤ d < T` or `1.01·T < d ≤ 1.1·T` (targets > 1 km only): tolerance result over the
 *   whole activity, so the pace is the average pace;
 * - otherwise no result.
 */
export function effortFromTotals(
  distanceKey: DistanceKey,
  distanceM: number,
  durationS: number,
): EffortValues | null {
  if (!(distanceM > 0) || !(durationS > 0)) return null;
  const { targetM } = DISTANCES[distanceKey];
  if (distanceM >= targetM && distanceM <= roundMetres(targetM * (1 + FULL_RESULT_MARGIN_RATIO))) {
    return effort(distanceKey, targetM, (durationS * targetM) / distanceM, false);
  }
  if (!toleranceApplies(targetM)) return null;
  const withinTolerance =
    qualifiesForTarget(distanceM, targetM) &&
    distanceM <= roundMetres(targetM * (1 + TOLERANCE_RATIO));
  return withinTolerance ? effort(distanceKey, distanceM, durationS, true) : null;
}

/**
 * A result changed by hand on the records page: the time over `actualDistanceM`. The totals
 * rule applies (PLAN.md Q8): a distance up to 1% over the target is a full result with the
 * time scaled to the target, a distance in the tolerance band a tolerance result (targets
 * > 1 km only). Null when the distance cannot give a result for the target.
 */
export function editedEffort(
  distanceKey: DistanceKey,
  actualDistanceM: number,
  durationS: number,
): EffortValues | null {
  return effortFromTotals(distanceKey, actualDistanceM, durationS);
}

/** All results of an activity without a stream, one per record distance of its sport. */
export function effortsFromTotals(
  sport: Sport,
  distanceM: number,
  durationS: number | null,
): EffortValues[] {
  if (durationS === null) return [];
  return sportDistances(sport)
    .map(({ key }) => effortFromTotals(key, distanceM, durationS))
    .filter((e): e is EffortValues => e !== null);
}

/**
 * All results of an activity with a stream (PLAN.md 4.1), one per record distance:
 * - the stream covers the target: the fastest contiguous segment of exactly the target;
 * - otherwise the totals rule (`effortFromTotals`), which gives a tolerance result over the
 *   whole activity when `0.9·T ≤ d < T`.
 */
export function effortsFromStream(
  sport: Sport,
  stream: Stream,
  distanceM: number,
  durationS: number | null,
): EffortValues[] {
  const covered = streamDistanceM(stream);
  const results: EffortValues[] = [];
  for (const { key, targetM } of sportDistances(sport)) {
    const fastest = covered >= targetM ? fastestSegmentS(stream, targetM) : null;
    const result =
      fastest !== null
        ? effort(key, targetM, fastest, false)
        : durationS !== null
          ? effortFromTotals(key, distanceM, durationS)
          : null;
    if (result) results.push(result);
  }
  return results;
}

/** Results of an activity: from its stream when it has one, from its totals otherwise. */
export function computeEfforts(activity: {
  sport: Sport;
  distanceM: number;
  durationS: number | null;
  stream?: Stream | null;
}): EffortValues[] {
  const { sport, distanceM, durationS, stream } = activity;
  return stream && stream.t.length >= 2
    ? effortsFromStream(sport, stream, distanceM, durationS)
    : effortsFromTotals(sport, distanceM, durationS);
}

/**
 * Result entered by hand in the simplified form ("record on a chosen distance").
 * The time covers the target, or the whole activity when it is shorter than the target
 * (a tolerance result). Returns null when the activity is too short for the target.
 */
export function manualEffort(
  distanceKey: DistanceKey,
  activityDistanceM: number,
  durationS: number,
): EffortValues | null {
  const { targetM } = DISTANCES[distanceKey];
  if (!(durationS > 0) || !qualifiesForTarget(activityDistanceM, targetM)) return null;
  return activityDistanceM >= targetM
    ? effort(distanceKey, targetM, durationS, false)
    : effort(distanceKey, activityDistanceM, durationS, true);
}
