import { describe, expect, it } from 'vitest';
import { computeEfforts, effortsFromStream } from './efforts';
import { sha256Hex } from './hash';
import type { Stream } from './schemas';
import {
  computeSplits,
  elevationGainPerSample,
  fastestSegmentS,
  streamDistanceM,
  streamElevationGainM,
} from './stream';

/** One sample per second at a constant pace (s/km), `alt` from a function of the second. */
function steady(distanceM: number, paceSPerKm: number, alt?: (s: number) => number): Stream {
  const speed = 1000 / paceSPerKm;
  const n = Math.ceil(distanceM / speed);
  const t = Array.from({ length: n + 1 }, (_, s) => s);
  const stream: Stream = { t, d: t.map((s) => Math.min(s * speed, distanceM)) };
  if (alt) stream.alt = t.map(alt);
  return stream;
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

describe('computeSplits', () => {
  it('splits a steady run into kilometres plus a flagged partial one', () => {
    const splits = computeSplits(steady(2500, 300));
    expect(splits).toEqual([
      { km: 1, distanceM: 1000, durationS: 300 },
      { km: 2, distanceM: 1000, durationS: 300 },
      { km: 3, distanceM: 500, durationS: 150, partial: true },
    ]);
  });

  it('interpolates the time at a kilometre boundary between samples', () => {
    const splits = computeSplits({ t: [0, 10, 20], d: [0, 990, 1010] });
    expect(splits[0]).toEqual({ km: 1, distanceM: 1000, durationS: 15 });
    expect(splits[1]).toEqual({ km: 2, distanceM: 10, durationS: 5, partial: true });
  });

  it('has no partial split when the run ends on a kilometre', () => {
    expect(computeSplits(steady(2000, 300)).map((s) => s.partial)).toEqual([undefined, undefined]);
  });

  it('starts the first split at the timer start even if the distance does not', () => {
    const splits = computeSplits({ t: [0, 300], d: [2.4, 1000] });
    expect(splits).toEqual([{ km: 1, distanceM: 1000, durationS: 300 }]);
  });

  it('returns nothing for fewer than two samples', () => {
    expect(computeSplits({ t: [0], d: [0] })).toEqual([]);
  });

  it('splits the elevation gain and scales it to the device total', () => {
    // 1 m up every 10 s for the first km, flat afterwards.
    const stream = steady(2000, 300, (s) => 100 + Math.min(Math.floor(s / 10), 30));
    const raw = computeSplits(stream);
    expect(raw.map((s) => s.elevationGainM)).toEqual([30, 0]);
    const scaled = computeSplits(stream, { totalAscentM: 27 });
    expect(scaled.map((s) => s.elevationGainM)).toEqual([27, 0]);
  });

  it('keeps integer gains that add up to the total', () => {
    const stream = steady(3000, 300, (s) => 100 + Math.floor(s / 30));
    const splits = computeSplits(stream, { totalAscentM: 31 });
    expect(splits.reduce((sum, s) => sum + s.elevationGainM!, 0)).toBe(31);
    splits.forEach((s) => expect(Number.isInteger(s.elevationGainM)).toBe(true));
  });
});

describe('elevation gain', () => {
  it('ignores noise below the threshold', () => {
    expect(elevationGainPerSample([100, 100.5, 100, 100.5, 100]).reduce((a, b) => a + b)).toBe(0);
    expect(elevationGainPerSample([100, 101, 100, 101, 102]).reduce((a, b) => a + b)).toBe(3);
  });

  it('is null without altitude', () => {
    expect(streamElevationGainM({ t: [0, 1], d: [0, 1] })).toBeNull();
  });
});

describe('fastestSegmentS', () => {
  it('equals the pace times the target on a steady run', () => {
    expect(fastestSegmentS(steady(5000, 300), 1000)).toBeCloseTo(300, 6);
    expect(fastestSegmentS(steady(5000, 300), 5000)).toBeCloseTo(1500, 6);
  });

  it('finds a fast kilometre in the middle, not aligned with the splits', () => {
    const stream = concat(steady(1500, 360), steady(1000, 240), steady(1500, 360));
    expect(fastestSegmentS(stream, 1000)).toBeCloseTo(240, 6);
    expect(computeSplits(stream).map((s) => s.durationS)).toEqual([360, 300, 300, 360]);
  });

  it('interpolates within sparse samples (smart recording)', () => {
    // Samples every 7 s at 3 m/s.
    const t = Array.from({ length: 100 }, (_, i) => i * 7);
    const stream = { t, d: t.map((s) => s * 3) };
    expect(fastestSegmentS(stream, 1000)).toBeCloseTo(1000 / 3, 6);
  });

  it('is null when the stream is shorter than the target', () => {
    expect(fastestSegmentS(steady(900, 300), 1000)).toBeNull();
    expect(streamDistanceM(steady(900, 300))).toBe(900);
  });
});

describe('effortsFromStream', () => {
  it('gives the fastest segment for every distance the stream covers', () => {
    const stream = concat(steady(2000, 300), steady(1000, 240), steady(2500, 300));
    const efforts = effortsFromStream('road_run', stream, 5500, stream.t.at(-1)!);
    expect(efforts.map((e) => [e.distanceKey, e.durationS, e.isTolerance])).toEqual([
      ['1k', 240, false],
      ['5k', 1440, false],
    ]);
  });

  it('falls back to a tolerance result for a run a bit short of the target', () => {
    const stream = steady(9300, 300);
    const efforts = effortsFromStream('road_run', stream, 9300, 2790);
    expect(efforts.at(-1)).toMatchObject({
      distanceKey: '10k',
      isTolerance: true,
      actualDistanceM: 9300,
      durationS: 2790,
      paceSPerKm: 300,
    });
  });

  it('uses the totals rule without a stream', () => {
    const keys = (stream?: Stream) =>
      computeEfforts({ sport: 'road_run', distanceM: 5000, durationS: 1500, stream }).map(
        (e) => e.distanceKey,
      );
    // Totals cannot tell the fastest kilometre.
    expect(keys()).toEqual(['5k']);
    expect(keys(steady(5000, 300))).toEqual(['1k', '5k']);
  });
});

describe('sha256Hex', () => {
  it('hashes bytes with Web Crypto', async () => {
    expect(await sha256Hex(Uint8Array.from([0x61, 0x62, 0x63]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
