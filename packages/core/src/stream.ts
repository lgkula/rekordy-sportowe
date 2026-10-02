import type { Split, Stream } from './schemas';
import { roundMetres } from './sports';

/**
 * Stream maths (PLAN.md 4.1 and 6): per-km splits and the fastest segment of a given length.
 * A stream is a list of samples `(t, d, alt?)`: timer time in seconds (pauses excluded,
 * strictly increasing), cumulative distance in metres (non-decreasing) and altitude in metres.
 */

export const SPLIT_LENGTH_M = 1000;
/** Altitude changes smaller than this are treated as noise when summing elevation gain. */
export const ELEVATION_THRESHOLD_M = 1;
/** A final piece shorter than this is not reported as a split. */
const MIN_PARTIAL_SPLIT_M = 1;

function roundSeconds(s: number): number {
  return Math.round(s * 10) / 10;
}

/** Timer time at distance `goal` between samples `a` and `b` (`d[a] < goal <= d[b]`). */
function timeAt(stream: Stream, a: number, b: number, goal: number): number {
  const d0 = stream.d[a]!;
  const d1 = stream.d[b]!;
  const t0 = stream.t[a]!;
  const t1 = stream.t[b]!;
  return d1 === d0 ? t1 : t0 + ((goal - d0) / (d1 - d0)) * (t1 - t0);
}

/** Distance covered by the stream (the first sample may not be at 0 m). */
export function streamDistanceM(stream: Stream): number {
  const n = stream.d.length;
  return n < 2 ? 0 : stream.d[n - 1]! - stream.d[0]!;
}

/**
 * Elevation gain reached at each sample, with a simple hysteresis: a climb counts once the
 * altitude is at least `threshold` above the last reference point; the reference follows
 * every counted climb and every drop of at least `threshold`.
 */
export function elevationGainPerSample(
  alt: readonly number[],
  threshold = ELEVATION_THRESHOLD_M,
): number[] {
  const gains = new Array<number>(alt.length).fill(0);
  if (alt.length === 0) return gains;
  let ref = alt[0]!;
  for (let i = 1; i < alt.length; i++) {
    const a = alt[i]!;
    if (a - ref >= threshold) {
      gains[i] = a - ref;
      ref = a;
    } else if (ref - a >= threshold) {
      ref = a;
    }
  }
  return gains;
}

/** Total elevation gain of a stream (see `elevationGainPerSample`), or null without altitude. */
export function streamElevationGainM(stream: Stream): number | null {
  if (!stream.alt || stream.alt.length !== stream.t.length) return null;
  return elevationGainPerSample(stream.alt).reduce((sum, g) => sum + g, 0);
}

/**
 * Rounds non-negative values to integers so that they add up to `total` (largest remainder
 * method).
 */
function apportion(values: readonly number[], total: number): number[] {
  const floors = values.map(Math.floor);
  let rest = total - floors.reduce((sum, v) => sum + v, 0);
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

/**
 * Per-km splits computed from the stream. Kilometre boundaries follow the cumulative
 * distance (as the watch's auto-lap does); the time at a boundary is interpolated linearly.
 * The last piece shorter than 1 km is included with `partial: true`.
 *
 * Elevation gain per split comes from the altitude samples. When the activity's total
 * ascent is known (from the device), the split gains are scaled to add up to it, so that
 * they match the summary shown by Garmin.
 */
export function computeSplits(
  stream: Stream,
  options: { totalAscentM?: number | null } = {},
): Split[] {
  const { t, d } = stream;
  const n = Math.min(t.length, d.length);
  if (n < 2) return [];

  const splits: Split[] = [];
  /** Index of the split each sample belongs to. */
  const sampleSplit = new Array<number>(n).fill(0);
  // The watch's distance counter may already be a few metres in at the first sample; the
  // first split still starts at the timer start and ends at the first full kilometre.
  let splitStartD = Math.floor(d[0]! / SPLIT_LENGTH_M) * SPLIT_LENGTH_M;
  let boundary = splitStartD + SPLIT_LENGTH_M;
  let splitStartT = t[0]!;
  for (let i = 1; i < n; i++) {
    while (d[i]! >= boundary) {
      const tb = timeAt(stream, i - 1, i, boundary);
      splits.push({
        km: splits.length + 1,
        distanceM: roundMetres(boundary - splitStartD),
        durationS: roundSeconds(tb - splitStartT),
      });
      splitStartT = tb;
      splitStartD = boundary;
      boundary += SPLIT_LENGTH_M;
    }
    // A sample exactly on a boundary closes the split that ends there.
    sampleSplit[i] = d[i]! === splitStartD && splits.length > 0 ? splits.length - 1 : splits.length;
  }
  const lastD = d[n - 1]!;
  const lastT = t[n - 1]!;
  if (lastD - splitStartD >= MIN_PARTIAL_SPLIT_M && roundSeconds(lastT - splitStartT) > 0) {
    splits.push({
      km: splits.length + 1,
      distanceM: roundMetres(lastD - splitStartD),
      durationS: roundSeconds(lastT - splitStartT),
      partial: true,
    });
  }

  if (stream.alt && stream.alt.length === n && splits.length > 0) {
    const raw = new Array<number>(splits.length).fill(0);
    elevationGainPerSample(stream.alt).forEach((gain, i) => {
      raw[Math.min(sampleSplit[i]!, splits.length - 1)]! += gain;
    });
    const rawTotal = raw.reduce((sum, g) => sum + g, 0);
    const target = options.totalAscentM;
    const gains =
      target != null && target >= 0 && rawTotal > 0
        ? apportion(
            raw.map((g) => (g * target) / rawTotal),
            target,
          )
        : raw.map(Math.round);
    splits.forEach((split, i) => {
      split.elevationGainM = gains[i]!;
    });
  }
  return splits;
}

/**
 * Duration of the fastest contiguous segment of exactly `targetM` metres (PLAN.md 4.1):
 * a two-pointer sliding window over the samples, once with windows starting at a sample and
 * once with windows ending at one, the other edge interpolated linearly. Null when the
 * stream is shorter than the target.
 */
export function fastestSegmentS(stream: Stream, targetM: number): number | null {
  const { t, d } = stream;
  const n = Math.min(t.length, d.length);
  if (n < 2 || !(targetM > 0) || d[n - 1]! - d[0]! < targetM) return null;
  let best = Infinity;

  // Windows starting at sample i; the end lies between j-1 and j.
  let j = 1;
  for (let i = 0; i < n; i++) {
    const goal = d[i]! + targetM;
    if (goal > d[n - 1]!) break;
    if (j <= i) j = i + 1;
    while (d[j]! < goal) j++;
    best = Math.min(best, timeAt(stream, j - 1, j, goal) - t[i]!);
  }

  // Windows ending at sample j; the start lies between k and k+1.
  let k = 0;
  for (let end = 1; end < n; end++) {
    const goal = d[end]! - targetM;
    if (goal < d[0]!) continue;
    while (d[k + 1]! <= goal) k++;
    best = Math.min(best, t[end]! - timeAt(stream, k, k + 1, goal));
  }

  return Number.isFinite(best) && best > 0 ? best : null;
}
