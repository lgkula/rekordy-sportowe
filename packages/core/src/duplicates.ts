/**
 * Fuzzy cross-source duplicate rule (PLAN.md 4.4, signal 5): a similar activity is only a
 * warning, the user decides whether to save anyway.
 */

/** Start times within ±2 minutes. */
export const SIMILAR_START_TOLERANCE_S = 120;
/** Distances within ±3% of the new activity's distance. */
export const SIMILAR_DISTANCE_RATIO = 0.03;

export type SimilarityInput = {
  /** `YYYY-MM-DD` */
  localDate: string;
  /** ISO timestamp, or null when only the date is known (manual entry). */
  startTimeUtc: string | null;
  distanceM: number;
};

/**
 * True when `existing` looks like the same activity as `candidate`. When either start time
 * is unknown, the same local date stands in for the ±2 min rule.
 */
export function isSimilarActivity(candidate: SimilarityInput, existing: SimilarityInput): boolean {
  const maxDiffM = candidate.distanceM * SIMILAR_DISTANCE_RATIO;
  if (Math.abs(candidate.distanceM - existing.distanceM) > maxDiffM) return false;
  if (candidate.startTimeUtc && existing.startTimeUtc) {
    const diffMs = Math.abs(Date.parse(candidate.startTimeUtc) - Date.parse(existing.startTimeUtc));
    return diffMs <= SIMILAR_START_TOLERANCE_S * 1000;
  }
  return candidate.localDate === existing.localDate;
}

/** Adds days to a `YYYY-MM-DD` date. */
export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
