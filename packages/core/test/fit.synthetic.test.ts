import { describe, expect, it } from 'vitest';
import {
  detectRace,
  detectSport,
  garminConnectUrl,
  parseFit,
  type FitParseResult,
} from '../src/fit';
import { buildFit, steadySamples, type Sample, type SyntheticActivity } from './fitBuilder';

async function parse(activity: SyntheticActivity, fileName = 'test.fit') {
  return parseFit(buildFit(activity), fileName);
}

function ok(result: FitParseResult) {
  if (!result.ok) throw new Error(`expected a parsed activity, got ${result.error}`);
  return result;
}

describe('parseFit: invalid files', () => {
  it('rejects a file that is not FIT', async () => {
    const result = await parseFit(new TextEncoder().encode('hello, not a FIT file'), 'x.fit');
    expect(result).toMatchObject({ ok: false, error: 'not_fit', fileName: 'x.fit' });
    expect(!result.ok && result.fileSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an empty file', async () => {
    expect(await parseFit(new Uint8Array(), 'empty.fit')).toMatchObject({ error: 'not_fit' });
  });

  it('rejects a truncated file', async () => {
    const bytes = buildFit({ samples: steadySamples(2000, 300) });
    const result = await parseFit(bytes.slice(0, Math.floor(bytes.length / 2)), 'cut.fit');
    expect(result).toMatchObject({ ok: false, error: 'corrupt' });
  });

  it('rejects a file with a damaged byte (bad CRC)', async () => {
    const bytes = buildFit({ samples: steadySamples(2000, 300) });
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
    expect(await parseFit(bytes, 'bad.fit')).toMatchObject({ ok: false, error: 'corrupt' });
  });

  it('rejects FIT files that are not activities', async () => {
    const result = await parse({ fileType: 'course', samples: steadySamples(1000, 300) });
    expect(result).toMatchObject({ ok: false, error: 'not_activity' });
  });

  it('rejects multisport activities', async () => {
    const result = await parse({ sessions: 2, samples: steadySamples(1000, 300) });
    expect(result).toMatchObject({ ok: false, error: 'multisport' });
  });

  it('reports unsupported sports with the raw FIT values', async () => {
    const result = await parse({
      sport: 'cycling',
      subSport: 'road',
      samples: steadySamples(5000, 120),
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'unsupported_sport',
      fitSport: 'cycling',
      fitSubSport: 'road',
    });
  });

  it('does not import treadmill runs', async () => {
    const result = await parse({ subSport: 'treadmill', samples: steadySamples(5000, 300) });
    expect(result).toMatchObject({
      ok: false,
      error: 'unsupported_sport',
      fitSubSport: 'treadmill',
    });
  });

  it('rejects an activity without distance', async () => {
    const samples: Sample[] = [0, 1, 2].map((s) => ({ s, d: null }));
    expect(await parse({ samples })).toMatchObject({ ok: false, error: 'no_distance' });
  });
});

describe('parseFit: stream', () => {
  it('uses timer time: paused periods are skipped', async () => {
    // 2 km at 5:00 /km with a 60 s stop after 500 m (the watch does not count distance).
    const samples: Sample[] = [];
    for (let s = 0; s <= 150; s++) samples.push({ s, d: (s * 1000) / 300 });
    for (let s = 151; s < 210; s++) samples.push({ s, d: 500 });
    for (let s = 210; s <= 660; s++) samples.push({ s, d: 500 + ((s - 210) * 1000) / 300 });
    const { activity } = ok(await parse({ samples, pauses: [[150, 210]] }));

    expect(activity.durationS).toBe(600);
    expect(activity.elapsedS).toBe(660);
    expect(activity.stream!.t.at(-1)).toBe(600);
    // One sample per timer second: the 59 samples recorded while paused are dropped.
    expect(activity.stream!.t).toHaveLength(601);
    expect(activity.splits!.map((s) => s.durationS)).toEqual([300, 300]);
  });

  it('drops samples without a distance and keeps the distance monotonic', async () => {
    const samples: Sample[] = steadySamples(1200, 300);
    samples[10] = { s: 10, d: null };
    samples[20] = { ...samples[20]!, d: samples[20]!.d! - 30 };
    const { activity } = ok(await parse({ samples }));
    const { t, d } = activity.stream!;
    expect(t).not.toContain(10);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]!);
  });

  it('cuts a GPS jump down to a plausible speed', async () => {
    // 3 km at 5:00 /km, then a 400 m jump within one second.
    const samples = steadySamples(3000, 300).map((x) => (x.s >= 400 ? { ...x, d: x.d! + 400 } : x));
    const { activity } = ok(await parse({ samples }));
    const { t, d } = activity.stream!;
    const i = t.indexOf(400);
    expect(d[i]! - d[i - 1]!).toBeLessThanOrEqual(12);
    // The device distance is kept as the activity distance; the stream drops the jump.
    expect(activity.distanceM).toBe(3400);
    expect(d.at(-1)).toBeCloseTo(3000 + 12 - 1000 / 300, 0);
  });

  it('handles a very short activity', async () => {
    const { activity } = ok(
      await parse({
        samples: [
          { s: 0, d: 0 },
          { s: 5, d: 20 },
        ],
      }),
    );
    expect(activity.distanceM).toBe(20);
    expect(activity.splits).toEqual([{ km: 1, distanceM: 20, durationS: 5, partial: true }]);
  });

  it('keeps a single-sample activity without a stream', async () => {
    const result = await parse({ samples: [{ s: 0, d: 5 }] });
    // Zero timer time: no usable activity.
    expect(result).toMatchObject({ ok: false, error: 'no_distance' });
  });

  it('fills altitude gaps from neighbouring samples', async () => {
    const samples = steadySamples(500, 300).map((x, i) => (i % 2 ? { s: x.s, d: x.d } : x));
    const { activity } = ok(await parse({ samples }));
    expect(activity.stream!.alt).toHaveLength(activity.stream!.t.length);
    expect(activity.stream!.alt!.every((a) => a === 100)).toBe(true);
  });

  it('omits altitude when the file has none', async () => {
    const samples = steadySamples(500, 300).map(({ s, d }) => ({ s, d }));
    const { activity } = ok(await parse({ samples }));
    expect(activity.stream!.alt).toBeUndefined();
    expect(activity.elevationGainM).toBeUndefined();
  });
});

describe('parseFit: metadata', () => {
  it('builds the external ID from the serial number and creation time', async () => {
    const { activity } = ok(await parse({ samples: steadySamples(1000, 300), serialNumber: 42 }));
    expect(activity.externalId).toBe(`garmin:42:${Date.parse('2026-06-01T06:00:00Z') / 1000}`);
  });

  it('takes the local date from the activity message', async () => {
    const start = new Date('2026-06-01T23:30:00Z');
    const { activity, details } = ok(
      await parse({ start, samples: steadySamples(1000, 300), utcOffsetS: 7200 }),
    );
    expect(details.utcOffsetS).toBe(7200);
    expect(activity.localDate).toBe('2026-06-02');
    expect(activity.name).toBe('Bieg 02.06.2026');
  });

  it('falls back to Polish time without a local timestamp', async () => {
    const winter = new Date('2026-01-10T23:30:00Z');
    const { activity, details } = ok(
      await parse({ start: winter, samples: steadySamples(1000, 300) }),
    );
    expect(details.utcOffsetS).toBe(3600);
    expect(activity.localDate).toBe('2026-01-11');
  });

  it('computes the elevation gain from the stream without a session total', async () => {
    const climb = (s: number) => 100 + Math.floor(s / 10);
    const { activity } = ok(await parse({ samples: steadySamples(1000, 300, climb) }));
    expect(activity.elevationGainM).toBe(30);
    expect(activity.splits![0]!.elevationGainM).toBe(30);
  });
});

describe('detectSport', () => {
  const base = {
    fitSport: 'running',
    fitSubSport: 'generic' as string | null,
    profileName: 'Bieg',
    distanceM: 10000,
    totalAscentM: 50 as number | null,
  };

  it('maps running sub-sports', () => {
    expect(detectSport(base)).toEqual({ ok: true, sport: 'road_run', source: 'sport' });
    for (const fitSubSport of ['street', 'track', null]) {
      expect(detectSport({ ...base, fitSubSport })).toMatchObject({ sport: 'road_run' });
    }
    expect(detectSport({ ...base, fitSubSport: 'trail' })).toEqual({
      ok: true,
      sport: 'trail_run',
      source: 'sub_sport',
    });
  });

  it('recognises trail profiles by name', () => {
    for (const profileName of ['Trail Run', 'Bieg w terenie', 'Przełaj', 'Bieg górski']) {
      expect(detectSport({ ...base, profileName })).toMatchObject({
        sport: 'trail_run',
        source: 'profile_name',
      });
    }
  });

  it('treats ≥ 20 m of climb per km as trail running', () => {
    expect(detectSport({ ...base, totalAscentM: 199 })).toMatchObject({ sport: 'road_run' });
    expect(detectSport({ ...base, totalAscentM: 200 })).toEqual({
      ok: true,
      sport: 'trail_run',
      source: 'elevation',
    });
    expect(detectSport({ ...base, totalAscentM: null })).toMatchObject({ sport: 'road_run' });
  });

  it('maps cross-country skiing and rejects the rest', () => {
    expect(detectSport({ ...base, fitSport: 'crossCountrySkiing' })).toMatchObject({
      sport: 'xc_ski',
    });
    expect(detectSport({ ...base, fitSport: 'cycling' })).toMatchObject({ ok: false });
    expect(detectSport({ ...base, fitSubSport: 'indoorRunning' })).toMatchObject({ ok: false });
  });
});

describe('detectRace', () => {
  it('flags races by the activity profile name', () => {
    expect(detectRace('Bieg zawody')).toEqual({
      isRace: true,
      isRaceConfidence: 'fit',
      raceSource: 'profile_name',
    });
    expect(detectRace('Race')).toMatchObject({ isRace: true });
    expect(detectRace('Bieg')).toEqual({
      isRace: false,
      isRaceConfidence: 'none',
      raceSource: null,
    });
    expect(detectRace(null)).toMatchObject({ isRace: false });
  });
});

describe('Garmin Connect link', () => {
  it('comes from the file name of an exported original', () => {
    expect(garminConnectUrl('24361800117_ACTIVITY.fit')).toBe(
      'https://connect.garmin.com/app/activity/24361800117',
    );
    expect(garminConnectUrl('24361800117_activity.FIT')).toBe(
      'https://connect.garmin.com/app/activity/24361800117',
    );
    expect(garminConnectUrl('trening 1.fit')).toBeNull();
    expect(garminConnectUrl('2026-09-14-17-46-29.fit')).toBeNull();
  });

  it('pre-fills the activity URL', async () => {
    const bytes = buildFit({ samples: steadySamples(1000, 300) });
    const exported = ok(await parseFit(bytes, '123_ACTIVITY.fit'));
    expect(exported.activity.activityUrl).toBe('https://connect.garmin.com/app/activity/123');
    const plain = ok(await parseFit(bytes, 'bieg.fit'));
    expect(plain.activity.activityUrl).toBeUndefined();
  });
});
