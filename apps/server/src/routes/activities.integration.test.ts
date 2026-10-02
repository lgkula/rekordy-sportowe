import path from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ActivityCreateInput,
  ActivityDetail,
  ActivityListResponse,
  DuplicateConflict,
} from '@rekordy/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Database } from '../db/client';
import { efforts } from '../db/schema';
import { loginHeaders, testAuth } from '../test/auth';
import { clearActivityData, openTestDatabase, testDbName } from '../test/db';

describe.skipIf(!testDbName)('/api/activities', () => {
  let database: Database;
  let app: FastifyInstance;
  let editor: { cookie: string };
  let viewer: { cookie: string };

  const full = {
    mode: 'full',
    sport: 'road_run',
    name: 'Parkrun',
    localDate: '2026-09-12',
    startTimeUtc: '2026-09-12T07:00:00.000Z',
    distanceM: 5020,
    durationS: 1205,
  } satisfies ActivityCreateInput;

  const simple = {
    mode: 'simple',
    sport: 'trail_run',
    name: 'Bieg po lesie',
    localDate: '2026-09-13',
    distanceM: 10200,
    activityUrl: 'https://www.strava.com/activities/123',
    manualEffort: { distanceKey: '5k', durationS: 1500 },
  } satisfies ActivityCreateInput;

  async function create(body: ActivityCreateInput & { confirmDuplicate?: boolean }) {
    return app.inject({ method: 'POST', url: '/api/activities', headers: editor, payload: body });
  }

  async function createOk(body: ActivityCreateInput): Promise<ActivityDetail> {
    const res = await create({ ...body, confirmDuplicate: true });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ActivityDetail>();
  }

  async function patch(id: number, payload: Record<string, unknown>) {
    return app.inject({ method: 'PATCH', url: `/api/activities/${id}`, headers: editor, payload });
  }

  async function list(query = '', headers = editor): Promise<ActivityListResponse> {
    const res = await app.inject({ url: `/api/activities${query}`, headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<ActivityListResponse>();
  }

  beforeAll(async () => {
    database = await openTestDatabase();
    app = await buildApp({
      webDir: path.join(tmpdir(), 'rekordy-no-web'),
      health: {
        checkDb: async () => {},
        migrationStatus: async () => ({ total: 0, applied: 0, pending: [] }),
        checkStorage: async () => true,
      },
      auth: testAuth(),
      db: database.db,
    });
    editor = await loginHeaders(app, 'editor');
    viewer = await loginHeaders(app, 'viewer');
  });

  beforeEach(async () => {
    await clearActivityData(database);
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  describe('access', () => {
    it('needs a session to read', async () => {
      expect((await app.inject('/api/activities')).statusCode).toBe(401);
    });

    it('lets a viewer read but not change anything', async () => {
      const activity = await createOk(full);
      expect((await list('', viewer)).total).toBe(1);
      const url = `/api/activities/${activity.id}`;
      expect((await app.inject({ url, headers: viewer })).statusCode).toBe(200);
      const attempts = [
        { method: 'POST', url: '/api/activities', payload: full },
        { method: 'PATCH', url, payload: { isHidden: true } },
        { method: 'DELETE', url },
      ] as const;
      for (const attempt of attempts) {
        expect((await app.inject({ ...attempt, headers: viewer })).statusCode).toBe(403);
      }
      expect((await app.inject({ url, headers: viewer })).json()).toMatchObject({
        isHidden: false,
      });
    });
  });

  describe('POST (full form)', () => {
    it('saves every field and computes efforts from the totals', async () => {
      const res = await create({
        ...full,
        elapsedS: 1230,
        elevationGainM: 35,
        isRace: true,
        editionLabel: '2026',
        notes: 'Pierwszy parkrun',
        activityUrl: 'https://connect.garmin.com/modern/activity/1',
        splits: [{ km: 1, distanceM: 1000, durationS: 240 }],
      });
      expect(res.statusCode, res.body).toBe(201);
      const activity = res.json<ActivityDetail>();
      expect(activity).toMatchObject({
        sport: 'road_run',
        name: 'Parkrun',
        localDate: '2026-09-12',
        startTimeUtc: '2026-09-12T07:00:00.000Z',
        distanceM: 5020,
        durationS: 1205,
        paceSPerKm: 240.04,
        elapsedS: 1230,
        elevationGainM: 35,
        isRace: true,
        isHidden: false,
        editionLabel: '2026',
        notes: 'Pierwszy parkrun',
        source: 'manual',
        splits: [{ km: 1, distanceM: 1000, durationS: 240 }],
        hasStream: false,
      });
      // 5.02 km is within +1%: a full 5 km result with the time scaled to 5 km.
      expect(activity.efforts).toEqual([
        expect.objectContaining({
          distanceKey: '5k',
          targetM: 5000,
          actualDistanceM: 5000,
          durationS: 1200.2,
          isTolerance: false,
          origin: 'computed',
        }),
      ]);
    });

    it('rejects invalid input', async () => {
      const res = await create({ ...full, distanceM: -5 });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST (simplified form)', () => {
    it('creates a manual_simple activity with one manual effort', async () => {
      const activity = await createOk(simple);
      expect(activity).toMatchObject({
        source: 'manual_simple',
        durationS: null,
        paceSPerKm: null,
        activityUrl: 'https://www.strava.com/activities/123',
      });
      expect(activity.efforts).toEqual([
        expect.objectContaining({
          sport: 'trail_run',
          distanceKey: '5k',
          actualDistanceM: 5000,
          durationS: 1500,
          paceSPerKm: 300,
          isTolerance: false,
          origin: 'manual',
        }),
      ]);
    });

    it('uses the result time for the activity when it is not longer than the target', async () => {
      const activity = await createOk({ ...simple, distanceM: 4600 });
      expect(activity.durationS).toBe(1500);
      expect(activity.efforts).toEqual([
        expect.objectContaining({ distanceKey: '5k', actualDistanceM: 4600, isTolerance: true }),
      ]);
    });

    it('keeps the whole-activity time when given and computes other distances from it', async () => {
      const activity = await createOk({ ...simple, distanceM: 10050, durationS: 3015 });
      expect(activity.efforts.map((e) => [e.distanceKey, e.origin, e.durationS])).toEqual([
        ['5k', 'manual', 1500],
        ['10k', 'computed', 3000],
      ]);
    });

    it('rejects a result on a distance longer than the activity', async () => {
      const res = await create({ ...simple, distanceM: 4000 });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('duplicates', () => {
    it('asks for confirmation when a similar activity exists', async () => {
      const first = await createOk(full);
      const res = await create({ ...full, startTimeUtc: '2026-09-12T07:01:00.000Z' });
      expect(res.statusCode).toBe(409);
      const conflict = res.json<DuplicateConflict>();
      expect(conflict).toMatchObject({ code: 'similar_activity', error: expect.any(String) });
      expect(conflict.code === 'similar_activity' && conflict.similar.map((a) => a.id)).toEqual([
        first.id,
      ]);

      const confirmed = await create({ ...full, confirmDuplicate: true });
      expect(confirmed.statusCode).toBe(201);
      expect((await list()).total).toBe(2);
    });

    it('compares by date when the new activity has no start time', async () => {
      await createOk(full);
      const res = await create({
        ...simple,
        sport: 'road_run',
        localDate: '2026-09-12',
        distanceM: 5100,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('GET list', () => {
    beforeEach(async () => {
      await createOk({ ...full, name: 'Bieg B', distanceM: 10000, localDate: '2026-09-01' });
      await createOk({ ...full, name: 'Ćwiczenia', distanceM: 5000, localDate: '2026-09-03' });
      await createOk({ ...full, name: 'Akademia', distanceM: 21097.5, localDate: '2026-09-02' });
      await createOk({ ...simple, name: 'Zielony', localDate: '2026-08-01' });
    });

    const names = (res: ActivityListResponse) => res.items.map((a) => a.name);

    it('sorts by date, newest first by default', async () => {
      expect(names(await list())).toEqual(['Ćwiczenia', 'Akademia', 'Bieg B', 'Zielony']);
      expect(names(await list('?sort=date&dir=asc'))).toEqual([
        'Zielony',
        'Bieg B',
        'Akademia',
        'Ćwiczenia',
      ]);
    });

    it('sorts by name in both directions', async () => {
      expect(names(await list('?sort=name'))).toEqual([
        'Akademia',
        'Bieg B',
        'Ćwiczenia',
        'Zielony',
      ]);
      expect(names(await list('?sort=name&dir=desc'))).toEqual([
        'Zielony',
        'Ćwiczenia',
        'Bieg B',
        'Akademia',
      ]);
    });

    it('sorts by distance in both directions', async () => {
      const distances = (res: ActivityListResponse) => res.items.map((a) => a.distanceM);
      expect(distances(await list('?sort=distance&dir=asc'))).toEqual([
        5000, 10000, 10200, 21097.5,
      ]);
      expect(distances(await list('?sort=distance&dir=desc'))).toEqual([
        21097.5, 10200, 10000, 5000,
      ]);
    });

    it('filters by sport', async () => {
      expect(names(await list('?sport=trail_run'))).toEqual(['Zielony']);
      expect((await list('?sport=road_run')).total).toBe(3);
    });

    it('pages', async () => {
      const page = await list('?sort=name&page=2&pageSize=3');
      expect(page).toMatchObject({ total: 4, page: 2, pageSize: 3 });
      expect(names(page)).toEqual(['Zielony']);
    });

    it('rejects an unknown sort', async () => {
      const res = await app.inject({ url: '/api/activities?sort=pace', headers: editor });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET one', () => {
    it('returns 404 for an unknown id', async () => {
      const res = await app.inject({ url: '/api/activities/999999', headers: viewer });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH', () => {
    it('hides and shows an activity, keeping it in the list', async () => {
      const activity = await createOk(full);
      const hidden = await patch(activity.id, { isHidden: true });
      expect(hidden.statusCode).toBe(200);
      expect(hidden.json()).toMatchObject({ isHidden: true, efforts: [expect.anything()] });
      expect((await list()).items[0]).toMatchObject({ id: activity.id, isHidden: true });
      expect((await patch(activity.id, { isHidden: false })).json()).toMatchObject({
        isHidden: false,
      });
    });

    it('updates the race flag, notes, URL and edition label, and clears them with null', async () => {
      const activity = await createOk(full);
      const updated = await patch(activity.id, {
        isRace: true,
        notes: 'Notatka',
        activityUrl: 'https://www.strava.com/activities/9',
        editionLabel: 'jesień',
      });
      expect(updated.json()).toMatchObject({
        isRace: true,
        notes: 'Notatka',
        activityUrl: 'https://www.strava.com/activities/9',
        editionLabel: 'jesień',
        name: 'Parkrun',
      });
      const cleared = await patch(activity.id, {
        notes: null,
        activityUrl: '',
        startTimeUtc: null,
      });
      expect(cleared.json()).toMatchObject({ notes: null, activityUrl: null, startTimeUtc: null });
    });

    it('recomputes efforts when the distance changes', async () => {
      const activity = await createOk(full);
      const updated = (
        await patch(activity.id, { distanceM: 10000, durationS: 2400 })
      ).json<ActivityDetail>();
      expect(updated.efforts.map((e) => [e.distanceKey, e.durationS])).toEqual([['10k', 2400]]);
    });

    it('keeps results changed or deleted by hand', async () => {
      const activity = await createOk(full);
      await database.db
        .update(efforts)
        .set({ isDeleted: true })
        .where(eq(efforts.activityId, activity.id));
      const updated = (await patch(activity.id, { durationS: 1300 })).json<ActivityDetail>();
      expect(updated.efforts).toEqual([
        expect.objectContaining({ distanceKey: '5k', durationS: 1200.2, isDeleted: true }),
      ]);
    });

    it('replaces the manual result and follows the activity distance', async () => {
      const activity = await createOk(simple);
      const changed = (
        await patch(activity.id, { manualEffort: { distanceKey: '10k', durationS: 3100 } })
      ).json<ActivityDetail>();
      expect(changed.efforts.map((e) => [e.distanceKey, e.origin, e.isTolerance])).toEqual([
        ['10k', 'manual', false],
      ]);

      const shorter = (await patch(activity.id, { distanceM: 9500 })).json<ActivityDetail>();
      expect(shorter.efforts).toEqual([
        expect.objectContaining({ distanceKey: '10k', actualDistanceM: 9500, isTolerance: true }),
      ]);
    });

    it('rejects a change that makes the manual result impossible', async () => {
      const activity = await createOk(simple);
      const res = await patch(activity.id, { distanceM: 3000 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        issues: [{ path: ['manualEffort', 'distanceKey'], code: 'effort_distance_too_short' }],
      });
    });

    it('returns 404 for an unknown id', async () => {
      expect((await patch(999999, { isHidden: true })).statusCode).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('deletes the activity and its efforts', async () => {
      const activity = await createOk(full);
      const url = `/api/activities/${activity.id}`;
      const res = await app.inject({ method: 'DELETE', url, headers: editor });
      expect(res.statusCode).toBe(204);
      expect((await app.inject({ url, headers: editor })).statusCode).toBe(404);
      const rows = await database.db
        .select()
        .from(efforts)
        .where(eq(efforts.activityId, activity.id));
      expect(rows).toEqual([]);
      expect((await app.inject({ method: 'DELETE', url, headers: editor })).statusCode).toBe(404);
    });
  });
});
