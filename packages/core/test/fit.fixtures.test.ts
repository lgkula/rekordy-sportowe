import { readFileSync } from 'node:fs';
import { Decoder, Stream as FitStream } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { computeEfforts } from '../src/efforts';
import { parseFit, type FitParseResult } from '../src/fit';

/**
 * The user's own Fenix 7X files (fw 27.18), anonymised with scripts/anonymize-fit.mjs: no
 * GPS, heart rate or device details; times, distances, altitude, laps and the activity
 * profile are original. Expected totals are the session summary, i.e. what Garmin Connect
 * shows.
 */
const FIXTURES = new URL('./fixtures/', import.meta.url);

function bytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(name, FIXTURES)));
}

async function parsed(name: string) {
  const result: FitParseResult = await parseFit(bytes(name), name);
  if (!result.ok) throw new Error(`${name}: ${result.error}`);
  return result;
}

/** Lap times recorded by the watch (auto-lap every 1 km in the race profile). */
function lapTimes(name: string): number[] {
  const { messages } = new Decoder(FitStream.fromByteArray(bytes(name))).read();
  return (messages.lapMesgs ?? []).map((lap) => lap.totalTimerTime as number);
}

const EXPECTED = [
  {
    file: 'training-1.fit',
    sport: 'road_run',
    name: 'Bieg 14.09.2026',
    localDate: '2026-09-14',
    startTimeUtc: '2026-09-14T17:46:29.000Z',
    distanceM: 8953.5,
    durationS: 4289.2,
    elevationGainM: 18,
    isRace: false,
  },
  {
    file: 'training-2.fit',
    sport: 'road_run',
    name: 'Bieg 22.09.2026',
    localDate: '2026-09-22',
    startTimeUtc: '2026-09-22T16:58:57.000Z',
    distanceM: 9620.5,
    durationS: 4563.2,
    elevationGainM: 19,
    isRace: false,
  },
  {
    file: 'training-3.fit',
    sport: 'road_run',
    name: 'Bieg 02.10.2026',
    localDate: '2026-10-02',
    startTimeUtc: '2026-10-02T16:55:19.000Z',
    distanceM: 7036,
    durationS: 3660.1,
    elevationGainM: 25,
    isRace: false,
  },
  {
    file: 'race-1.fit',
    sport: 'road_run',
    name: 'Bieg zawody 27.09.2026',
    localDate: '2026-09-27',
    startTimeUtc: '2026-09-27T10:00:10.000Z',
    distanceM: 9730.4,
    durationS: 3154.9,
    elevationGainM: 12,
    isRace: true,
  },
  {
    file: 'race-2-mountain.fit',
    sport: 'trail_run',
    name: 'Bieg zawody 19.09.2026',
    localDate: '2026-09-19',
    startTimeUtc: '2026-09-19T09:59:58.000Z',
    distanceM: 10301,
    durationS: 4364.9,
    elevationGainM: 346,
    isRace: true,
  },
  {
    file: 'race-3.fit',
    sport: 'road_run',
    name: 'Bieg zawody 30.05.2026',
    localDate: '2026-05-30',
    startTimeUtc: '2026-05-30T17:02:59.000Z',
    distanceM: 10056.4,
    durationS: 3364.9,
    elevationGainM: 15,
    isRace: true,
  },
] as const;

describe('parseFit on the user’s files', () => {
  it.each(EXPECTED)('$file: summary, sport and race flag', async (expected) => {
    const { activity, details } = await parsed(expected.file);
    expect(activity).toMatchObject({
      sport: expected.sport,
      name: expected.name,
      localDate: expected.localDate,
      startTimeUtc: expected.startTimeUtc,
      distanceM: expected.distanceM,
      durationS: expected.durationS,
      elevationGainM: expected.elevationGainM,
      isRace: expected.isRace,
      isRaceConfidence: expected.isRace ? 'fit' : 'none',
      fileName: expected.file,
    });
    expect(activity.fileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(activity.externalId).toMatch(/^garmin:1000000001:\d{10}$/);
    expect(details.utcOffsetS).toBe(7200);
    expect(details.raceSource).toBe(expected.isRace ? 'profile_name' : null);
  });

  it.each(EXPECTED)('$file: the stream matches the summary', async (expected) => {
    const { activity } = await parsed(expected.file);
    const stream = activity.stream!;
    expect(stream.t.length).toBe(stream.d.length);
    expect(stream.alt?.length).toBe(stream.t.length);
    // Timer axis: ends at the timer total; distance ends at the total distance.
    expect(stream.t.at(-1)).toBeCloseTo(expected.durationS, -1);
    expect(stream.d.at(-1)).toBeCloseTo(expected.distanceM, 0);
    for (let i = 1; i < stream.t.length; i++) {
      expect(stream.t[i]).toBeGreaterThan(stream.t[i - 1]!);
      expect(stream.d[i]).toBeGreaterThanOrEqual(stream.d[i - 1]!);
    }
  });

  it.each(EXPECTED)('$file: splits add up to the totals', async (expected) => {
    const { activity } = await parsed(expected.file);
    const splits = activity.splits!;
    const fullKm = Math.floor(expected.distanceM / 1000);
    expect(splits.filter((s) => !s.partial)).toHaveLength(fullKm);
    expect(splits.at(-1)?.partial).toBe(true);
    const distance = splits.reduce((sum, s) => sum + s.distanceM, 0);
    const time = splits.reduce((sum, s) => sum + s.durationS, 0);
    const gain = splits.reduce((sum, s) => sum + (s.elevationGainM ?? 0), 0);
    expect(distance).toBeCloseTo(expected.distanceM, 0);
    expect(Math.abs(time - expected.durationS)).toBeLessThan(2);
    expect(gain).toBe(expected.elevationGainM);
  });

  it.each(['race-1.fit', 'race-2-mountain.fit', 'race-3.fit'])(
    '%s: per-km splits match the watch’s 1 km auto-laps within 2 s',
    async (file) => {
      const { activity } = await parsed(file);
      const laps = lapTimes(file);
      expect(activity.splits).toHaveLength(laps.length);
      activity.splits!.forEach((split, i) => {
        expect(Math.abs(split.durationS - laps[i]!)).toBeLessThan(2);
      });
    },
  );

  it('the mountain race is trail running because of its climb', async () => {
    const { details } = await parsed('race-2-mountain.fit');
    expect(details).toMatchObject({
      sportProfileName: 'Bieg zawody',
      fitSport: 'running',
      fitSubSport: 'generic',
      sportSource: 'elevation',
    });
  });

  it('a renamed copy keeps its hash and watch ID (duplicate signals)', async () => {
    const original = await parseFit(bytes('race-1.fit'), 'race-1.fit');
    const copy = await parseFit(bytes('race-1.fit'), 'kopia.fit');
    expect(original.ok && copy.ok).toBe(true);
    if (!original.ok || !copy.ok) return;
    expect(copy.activity.fileSha256).toBe(original.activity.fileSha256);
    expect(copy.activity.externalId).toBe(original.activity.externalId);
    expect(copy.activity.fileName).toBe('kopia.fit');
  });

  it('computes record results from the race stream', async () => {
    const { activity } = await parsed('race-1.fit');
    const efforts = computeEfforts(activity);
    expect(efforts.map((e) => [e.distanceKey, e.isTolerance])).toEqual([
      ['1k', false],
      ['5k', false],
      // 9.73 km: a tolerance result for 10 km over the whole race.
      ['10k', true],
    ]);
    const tenK = efforts[2]!;
    expect(tenK.durationS).toBe(3154.9);
    expect(tenK.actualDistanceM).toBe(9730.4);
    // The fastest 1 km is at least as fast as the fastest full 1 km auto-lap.
    const fullLaps = lapTimes('race-1.fit').slice(0, -1);
    expect(efforts[0]!.durationS).toBeLessThanOrEqual(Math.min(...fullLaps) + 0.5);
  });
});
