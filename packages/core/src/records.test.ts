import { describe, expect, it } from 'vitest';
import { computeEfforts, editedEffort, type EffortValues } from './efforts';
import type { NormalizedActivity, Stream } from './schemas';
import { DISTANCES } from './sports';

/**
 * Records engine scenarios (PLAN.md 4.1): what `computeEfforts` gives for typical activities.
 * Streams are timer time (pauses already removed by the FIT parser) and cumulative distance.
 */

/** One sample every `step` seconds at a constant pace (s/km). */
function steady(distanceM: number, paceSPerKm: number, step = 1): Stream {
  const speed = 1000 / paceSPerKm;
  const n = Math.ceil(distanceM / speed / step);
  const t = Array.from({ length: n + 1 }, (_, i) => i * step);
  return { t, d: t.map((s) => Math.min(s * speed, distanceM)) };
}

/** Standing still for `seconds` with the timer running (no auto-pause). */
function standstill(seconds: number): Stream {
  const t = Array.from({ length: seconds + 1 }, (_, s) => s);
  return { t, d: t.map(() => 0) };
}

/** Joins streams one after another (times and distances continue). */
function concat(...parts: Stream[]): Stream {
  const out: Stream = { t: [], d: [] };
  for (const part of parts) {
    const t0 = out.t.at(-1) ?? 0;
    const d0 = out.d.at(-1) ?? 0;
    const skip = out.t.length > 0 ? 1 : 0;
    out.t.push(...part.t.slice(skip).map((t) => t + t0));
    out.d.push(...part.d.slice(skip).map((d) => d + d0));
  }
  return out;
}

function run(stream: Stream, sport: 'road_run' | 'trail_run' = 'road_run'): EffortValues[] {
  return computeEfforts({
    sport,
    distanceM: stream.d.at(-1)!,
    durationS: stream.t.at(-1)!,
    stream,
  });
}

/** `[distanceKey, durationS, isTolerance]` per result, for compact assertions. */
function summary(efforts: EffortValues[]): [string, number, boolean][] {
  return efforts.map((e) => [e.distanceKey, e.durationS, e.isTolerance]);
}

describe('computeEfforts', () => {
  it('gives full results for a run of exactly the target', () => {
    expect(summary(run(steady(5000, 300)))).toEqual([
      ['1k', 300, false],
      ['5k', 1500, false],
    ]);
    expect(run(steady(10000, 270)).at(-1)).toEqual({
      distanceKey: '10k',
      targetM: 10000,
      actualDistanceM: 10000,
      durationS: 2700,
      paceSPerKm: 270,
      isTolerance: false,
    });
  });

  it('counts 4.6 km for 5 km as a tolerance result over the whole run', () => {
    const efforts = run(steady(4600, 300));
    expect(summary(efforts)).toEqual([
      ['1k', 300, false],
      ['5k', 1380, true],
    ]);
    expect(efforts[1]).toMatchObject({ actualDistanceM: 4600, paceSPerKm: 300, targetM: 5000 });
  });

  it('gives nothing below 90% of the target', () => {
    // 0.89·T for 5 km and 10 km.
    expect(summary(run(steady(4450, 300)))).toEqual([['1k', 300, false]]);
    expect(summary(run(steady(8900, 300)))).toEqual([
      ['1k', 300, false],
      ['5k', 1500, false],
    ]);
  });

  it('gives a 10 km tolerance result and full 5 km and 1 km results for 9.3 km', () => {
    const stream = concat(steady(4000, 320), steady(5300, 290));
    const efforts = run(stream);
    expect(summary(efforts)).toEqual([
      ['1k', 290, false],
      ['5k', 1450, false],
      ['10k', 2817, true],
    ]);
    expect(efforts[2]).toMatchObject({ actualDistanceM: 9300, paceSPerKm: 302.903 });
  });

  it('finds a fast 5 km in the middle of a 10 km run', () => {
    const stream = concat(steady(2500, 330), steady(5000, 270), steady(2500, 330));
    expect(summary(run(stream))).toEqual([
      ['1k', 270, false],
      ['5k', 1350, false],
      ['10k', 3000, false],
    ]);
  });

  it('includes a standstill only when no window avoids it', () => {
    // 2 min standing at 500 m: the 5 km after it is clean.
    const avoidable = concat(steady(500, 300), standstill(120), steady(5000, 300));
    expect(summary(run(avoidable))).toEqual([
      ['1k', 300, false],
      ['5k', 1500, false],
    ]);
    // 1 min standing at half way of exactly 5 km: every 5 km window contains it.
    const unavoidable = concat(steady(2500, 300), standstill(60), steady(2500, 300));
    expect(summary(run(unavoidable))).toEqual([
      ['1k', 300, false],
      ['5k', 1560, false],
    ]);
  });

  it('does not count auto-paused time (the timer axis has no gap)', () => {
    // An auto-pause leaves no samples: the timer continues where it stopped.
    const stream = concat(steady(2500, 300), steady(2500, 300));
    const activity = { sport: 'road_run' as const, distanceM: 5000, durationS: 1500, stream };
    expect(summary(computeEfforts(activity))).toEqual([
      ['1k', 300, false],
      ['5k', 1500, false],
    ]);
  });

  it('interpolates segment edges between sparse samples', () => {
    // 600 m at 5 m/s, then 2.5 m/s: the fastest 1 km is the first 600 m plus 400 m = 280 s.
    const exact = (s: number) => (s <= 120 ? s * 5 : 600 + (s - 120) * 2.5);
    const sampled = (step: number): Stream => {
      const t = Array.from({ length: Math.floor(1000 / step) + 1 }, (_, i) => i * step);
      return { t, d: t.map(exact) };
    };
    const at1Hz = run(sampled(1))[0]!;
    expect(at1Hz.durationS).toBe(280);
    // Smart recording (one sample every 7 s, the speed change between two samples):
    // the interpolated result stays within a second of the exact one.
    const sparse = run(sampled(7))[0]!;
    expect(Math.abs(sparse.durationS - 280)).toBeLessThan(1);
  });

  it('has no tolerance for 1 km', () => {
    expect(run(steady(999, 300))).toEqual([]);
    expect(run(steady(950, 300))).toEqual([]);
    expect(summary(run(steady(1000, 300)))).toEqual([['1k', 300, false]]);
  });

  it('takes the fastest 21.0975 km of a half marathon measured as 21.3 km by GPS', () => {
    const stream = steady(21300, 300);
    const hm = run(stream).at(-1)!;
    expect(hm).toMatchObject({
      distanceKey: 'hm',
      targetM: DISTANCES.hm.targetM,
      actualDistanceM: 21097.5,
      paceSPerKm: 300,
      isTolerance: false,
    });
    // 21 097.5 m at 5:00 /km = 6329.25 s (stored with 0.1 s precision).
    expect(Math.abs(hm.durationS - 6329.25)).toBeLessThanOrEqual(0.051);
  });

  it('scales the totals of a 21.3 km half marathon without a stream to the target', () => {
    const efforts = computeEfforts({ sport: 'road_run', distanceM: 21300, durationS: 6390 });
    expect(summary(efforts)).toEqual([['hm', 6329.3, false]]);
  });

  it('accepts a normalised activity from an import', () => {
    const stream = steady(5000, 300);
    const activity: NormalizedActivity = {
      sport: 'trail_run',
      name: 'Bieg',
      startTimeUtc: '2026-09-27T08:00:00.000Z',
      localDate: '2026-09-27',
      distanceM: 5000,
      durationS: 1500,
      isRace: false,
      isRaceConfidence: 'none',
      stream,
    };
    expect(summary(computeEfforts(activity))).toEqual([
      ['1k', 300, false],
      ['5k', 1500, false],
    ]);
  });

  it('gives nothing without a duration or for an empty stream', () => {
    expect(computeEfforts({ sport: 'road_run', distanceM: 5000, durationS: null })).toEqual([]);
    expect(
      computeEfforts({ sport: 'road_run', distanceM: 0, durationS: 10, stream: { t: [], d: [] } }),
    ).toEqual([]);
  });
});

describe('editedEffort (a result changed by hand)', () => {
  it('keeps a full result at the target', () => {
    expect(editedEffort('5k', 5000, 1190)).toMatchObject({
      actualDistanceM: 5000,
      durationS: 1190,
      paceSPerKm: 238,
      isTolerance: false,
    });
  });

  it('scales a distance up to 1% over the target to the target', () => {
    expect(editedEffort('5k', 5050, 1212)).toMatchObject({
      actualDistanceM: 5000,
      durationS: 1200,
      isTolerance: false,
    });
  });

  it('makes a shorter distance a tolerance result', () => {
    expect(editedEffort('10k', 9500, 2850)).toMatchObject({
      actualDistanceM: 9500,
      paceSPerKm: 300,
      isTolerance: true,
    });
  });

  it('rejects distances that cannot give a result', () => {
    expect(editedEffort('1k', 950, 280)).toBeNull();
    expect(editedEffort('1k', 1050, 280)).toBeNull();
    expect(editedEffort('5k', 4400, 1300)).toBeNull();
    expect(editedEffort('5k', 5600, 1650)).toBeNull();
  });
});
