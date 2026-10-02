import { describe, expect, it } from 'vitest';
import {
  activityCreateSchema,
  activityIssues,
  activityListQuerySchema,
  activityPatchSchema,
  normalizedActivitySchema,
} from './schemas';

function codes(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return (result.error?.issues ?? []).map((i) => `${i.path.join('.')}:${i.message}`);
}

const full = {
  mode: 'full',
  sport: 'road_run',
  name: 'Parkrun',
  localDate: '2026-09-12',
  startTimeUtc: '2026-09-12T07:00:00.000Z',
  distanceM: 5020,
  durationS: 1260,
} as const;

const simple = {
  mode: 'simple',
  sport: 'trail_run',
  name: 'Bieg po lesie',
  localDate: '2026-09-13',
  distanceM: 10200,
  manualEffort: { distanceKey: '5k', durationS: 1500 },
} as const;

describe('activityCreateSchema', () => {
  it('accepts a minimal full activity and fills defaults', () => {
    const result = activityCreateSchema.parse(full);
    expect(result).toMatchObject({ ...full, isRace: false, isHidden: false });
  });

  it('accepts a complete full activity, turning empty strings into null', () => {
    const result = activityCreateSchema.parse({
      ...full,
      elapsedS: 1300,
      elevationGainM: 42,
      isRace: true,
      editionLabel: '  2026 ',
      notes: '',
      activityUrl: '',
      splits: [{ km: 1, distanceM: 1000, durationS: 250, elevationGainM: null }],
    });
    expect(result).toMatchObject({ editionLabel: '2026', notes: null, activityUrl: null });
  });

  it('accepts a simplified activity', () => {
    expect(activityCreateSchema.safeParse(simple).success).toBe(true);
  });

  it('reports validation codes', () => {
    const result = activityCreateSchema.safeParse({
      ...full,
      name: '  ',
      localDate: '12.09.2026',
      distanceM: 0,
      durationS: -1,
      elevationGainM: 1.5,
      activityUrl: 'javascript:alert(1)',
    });
    expect(codes(result)).toEqual([
      'name:required',
      'localDate:invalid_date',
      'distanceM:invalid_distance',
      'durationS:invalid_duration',
      'elevationGainM:invalid_elevation',
      'activityUrl:invalid_url',
    ]);
  });

  it('requires the time in the full form but not in the simplified one', () => {
    const { durationS: _omit, ...withoutTime } = full;
    expect(codes(activityCreateSchema.safeParse(withoutTime))).toEqual([
      'durationS:invalid_duration',
    ]);
    expect(activityCreateSchema.safeParse({ ...simple, durationS: null }).success).toBe(true);
  });

  it('checks cross-field rules', () => {
    expect(codes(activityCreateSchema.safeParse({ ...full, elapsedS: 1200 }))).toEqual([
      'elapsedS:elapsed_lt_duration',
    ]);
    expect(
      codes(
        activityCreateSchema.safeParse({
          ...simple,
          distanceM: 4400,
          manualEffort: { distanceKey: '5k', durationS: 1100 },
        }),
      ),
    ).toEqual(['manualEffort.distanceKey:effort_distance_too_short']);
  });

  it('rejects an unknown mode or sport', () => {
    expect(activityCreateSchema.safeParse({ ...full, mode: 'other' }).success).toBe(false);
    expect(codes(activityCreateSchema.safeParse({ ...full, sport: 'swim' }))).toEqual([
      'sport:invalid_sport',
    ]);
  });
});

describe('activityIssues', () => {
  it('rejects a distance the sport does not have', () => {
    expect(
      activityIssues({
        sport: 'xc_ski',
        distanceM: 1000,
        manualEffort: { distanceKey: '1k', durationS: 200 },
      }),
    ).toEqual([{ path: ['manualEffort', 'distanceKey'], code: 'distance_not_for_sport' }]);
  });
});

describe('activityPatchSchema', () => {
  it('keeps absent fields absent and clears with null', () => {
    expect(activityPatchSchema.parse({ isHidden: true })).toEqual({ isHidden: true });
    expect(activityPatchSchema.parse({ notes: null, activityUrl: '' })).toEqual({
      notes: null,
      activityUrl: null,
    });
  });
});

describe('activityListQuerySchema', () => {
  it('has defaults and coerces query strings', () => {
    expect(activityListQuerySchema.parse({})).toEqual({ sort: 'date', page: 1, pageSize: 50 });
    expect(
      activityListQuerySchema.parse({ sort: 'name', dir: 'asc', page: '3', pageSize: '20' }),
    ).toEqual({ sort: 'name', dir: 'asc', page: 3, pageSize: 20 });
    expect(activityListQuerySchema.safeParse({ sort: 'pace' }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ pageSize: '1000' }).success).toBe(false);
  });
});

describe('normalizedActivitySchema', () => {
  it('accepts an imported activity with a stream', () => {
    const result = normalizedActivitySchema.safeParse({
      sport: 'road_run',
      name: 'Morning Run',
      startTimeUtc: '2026-09-12T07:00:00Z',
      localDate: '2026-09-12',
      distanceM: 5000,
      durationS: 1200,
      isRace: false,
      isRaceConfidence: 'none',
      externalId: 'garmin:3456789:1094567890',
      fileName: '2026-09-12-07-00-00.fit',
      fileSha256: 'a'.repeat(64),
      stream: { t: [0, 1], d: [0, 3.5] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed hash', () => {
    const result = normalizedActivitySchema.safeParse({
      sport: 'road_run',
      name: 'x',
      startTimeUtc: '2026-09-12T07:00:00Z',
      localDate: '2026-09-12',
      distanceM: 5000,
      durationS: 1200,
      isRace: false,
      isRaceConfidence: 'none',
      fileSha256: 'XYZ',
    });
    expect(codes(result)).toEqual(['fileSha256:invalid_hash']);
  });
});
