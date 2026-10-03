import path from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ActivityCreateInput,
  ActivityDetail,
  DeletedEffort,
  Effort,
  Job,
  RecordsResponse,
} from '@rekordy/core';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { Database } from '../db/client';
import { activities, efforts, jobs } from '../db/schema';
import { runJobChunk } from '../jobs/service';
import { loginHeaders, testAuth } from '../test/auth';
import { clearActivityData, openTestDatabase, testDbName } from '../test/db';

describe.skipIf(!testDbName)('/api/records, /api/efforts, /api/admin', () => {
  let database: Database;
  let app: FastifyInstance;
  let editor: { cookie: string };
  let viewer: { cookie: string };
  let day = 0;

  /** A 5 km run from totals only: one `5k` effort at `durationS`. */
  function fiveK(durationS: number, overrides: Partial<ActivityCreateInput> = {}) {
    day++;
    return {
      mode: 'full',
      sport: 'road_run',
      name: `Bieg ${day}`,
      localDate: `2026-08-${String(day).padStart(2, '0')}`,
      distanceM: 5000,
      durationS,
      ...overrides,
    } as ActivityCreateInput;
  }

  async function createOk(body: ActivityCreateInput): Promise<ActivityDetail> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/activities',
      headers: editor,
      payload: { ...body, confirmDuplicate: true },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<ActivityDetail>();
  }

  function effortOf(activity: ActivityDetail, key = '5k'): Effort {
    const effort = activity.efforts.find((e) => e.distanceKey === key);
    if (!effort) throw new Error(`No ${key} effort`);
    return effort;
  }

  async function records(sport = 'road_run', headers = editor): Promise<RecordsResponse> {
    const res = await app.inject({ url: `/api/records?sport=${sport}`, headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<RecordsResponse>();
  }

  /** Activity names of the 5 km top 3, best first. */
  async function top5k(): Promise<string[]> {
    const result = await records();
    return (
      result.distances.find((d) => d.distanceKey === '5k')?.entries.map((e) => e.activityName) ?? []
    );
  }

  async function patchEffort(id: number, payload: Record<string, unknown>) {
    return app.inject({ method: 'PATCH', url: `/api/efforts/${id}`, headers: editor, payload });
  }

  async function recomputeAll(): Promise<Job> {
    const start = await app.inject({
      method: 'POST',
      url: '/api/admin/recompute-all',
      headers: editor,
    });
    expect(start.statusCode, start.body).toBe(201);
    let job = start.json<Job>();
    while (job.status === 'running') {
      const res = await app.inject({
        method: 'POST',
        url: `/api/admin/jobs/${job.id}/run`,
        headers: editor,
      });
      expect(res.statusCode, res.body).toBe(200);
      job = res.json<Job>();
    }
    return job;
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
    day = 0;
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  describe('access', () => {
    it('needs a session to read the records', async () => {
      expect((await app.inject('/api/records?sport=road_run')).statusCode).toBe(401);
    });

    it('lets a viewer read the records but nothing else', async () => {
      const effort = effortOf(await createOk(fiveK(1200)));
      expect((await records('road_run', viewer)).distances).toHaveLength(1);
      const attempts = [
        { method: 'PATCH', url: `/api/efforts/${effort.id}`, payload: { durationS: 1 } },
        { method: 'DELETE', url: `/api/efforts/${effort.id}` },
        { method: 'POST', url: `/api/efforts/${effort.id}/restore` },
        { method: 'POST', url: `/api/efforts/${effort.id}/reset` },
        { method: 'GET', url: '/api/efforts/deleted' },
        { method: 'GET', url: '/api/admin/recompute-all' },
        { method: 'POST', url: '/api/admin/recompute-all' },
        { method: 'GET', url: '/api/admin/jobs/1' },
        { method: 'POST', url: '/api/admin/jobs/1/run' },
      ] as const;
      for (const attempt of attempts) {
        const res = await app.inject({ ...attempt, headers: viewer });
        expect(res.statusCode, `${attempt.method} ${attempt.url}`).toBe(403);
      }
    });

    it('validates the sport', async () => {
      const res = await app.inject({ url: '/api/records?sport=swim', headers: editor });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/records', () => {
    it('returns the top 3 by pace per distance, only distances with results', async () => {
      await createOk(fiveK(1230));
      await createOk(fiveK(1200));
      await createOk(fiveK(1215));
      await createOk(fiveK(1190, { sport: 'trail_run' }));
      // 4.6 km at 3:50 /km: a tolerance result, faster than every full 5 km.
      await createOk(fiveK(1058, { distanceM: 4600, activityUrl: 'https://strava.com/a/1' }));

      const result = await records();
      expect(result.sport).toBe('road_run');
      expect(result.distances.map((d) => d.distanceKey)).toEqual(['5k']);
      const [first, second, third, ...rest] = result.distances[0]!.entries;
      expect(rest).toEqual([]);
      expect(first).toMatchObject({
        activityName: 'Bieg 5',
        activityUrl: 'https://strava.com/a/1',
        paceSPerKm: 230,
        durationS: null,
        actualDistanceM: 4600,
        isTolerance: true,
        origin: 'computed',
        isEdited: false,
      });
      expect(second).toMatchObject({ activityName: 'Bieg 2', durationS: 1200, paceSPerKm: 240 });
      expect(third).toMatchObject({ activityName: 'Bieg 3', durationS: 1215, isTolerance: false });
      expect(second!.localDate).toBe('2026-08-02');

      const trail = await records('trail_run');
      expect(trail.distances[0]!.entries.map((e) => e.activityName)).toEqual(['Bieg 4']);
      expect((await records('xc_ski')).distances).toEqual([]);
    });

    it('puts the earlier activity first on equal pace', async () => {
      await createOk(fiveK(1200, { localDate: '2026-05-02', name: 'Później' }));
      await createOk(fiveK(1200, { localDate: '2026-05-01', name: 'Wcześniej' }));
      expect(await top5k()).toEqual(['Wcześniej', 'Później']);
    });

    it('excludes a hidden activity immediately and promotes the next result', async () => {
      const best = await createOk(fiveK(1100, { name: 'Najlepszy' }));
      for (const time of [1200, 1210, 1220]) await createOk(fiveK(time));
      expect(await top5k()).toEqual(['Najlepszy', 'Bieg 2', 'Bieg 3']);

      const hide = await app.inject({
        method: 'PATCH',
        url: `/api/activities/${best.id}`,
        headers: editor,
        payload: { isHidden: true },
      });
      expect(hide.statusCode, hide.body).toBe(200);
      expect(await top5k()).toEqual(['Bieg 2', 'Bieg 3', 'Bieg 4']);
    });
  });

  describe('DELETE /api/efforts/:id and restore', () => {
    it('soft-deletes a result, promotes the 4th one and lists it for restoring', async () => {
      const best = await createOk(fiveK(1100, { name: 'Najlepszy' }));
      for (const time of [1200, 1210, 1220]) await createOk(fiveK(time));
      const effort = effortOf(best);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/efforts/${effort.id}`,
        headers: editor,
      });
      expect(del.statusCode).toBe(204);
      expect(await top5k()).toEqual(['Bieg 2', 'Bieg 3', 'Bieg 4']);

      const deleted = await app.inject({
        url: '/api/efforts/deleted?sport=road_run',
        headers: editor,
      });
      expect(deleted.json<DeletedEffort[]>()).toMatchObject([
        { effortId: effort.id, activityName: 'Najlepszy', distanceKey: '5k', durationS: 1100 },
      ]);

      // Recomputation (an activity edit) does not bring it back.
      await app.inject({
        method: 'PATCH',
        url: `/api/activities/${best.id}`,
        headers: editor,
        payload: { name: 'Najlepszy!' },
      });
      expect(await top5k()).toEqual(['Bieg 2', 'Bieg 3', 'Bieg 4']);

      const restore = await app.inject({
        method: 'POST',
        url: `/api/efforts/${effort.id}/restore`,
        headers: editor,
      });
      expect(restore.statusCode, restore.body).toBe(200);
      expect(restore.json<Effort>()).toMatchObject({ isDeleted: false, durationS: 1100 });
      expect(await top5k()).toEqual(['Najlepszy!', 'Bieg 2', 'Bieg 3']);
      const after = await app.inject({ url: '/api/efforts/deleted', headers: editor });
      expect(after.json()).toEqual([]);
    });

    it('answers 404 for an unknown result', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/efforts/999999',
        headers: editor,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/efforts/:id', () => {
    it('changes the time, recalculates the pace and marks the result as edited', async () => {
      const effort = effortOf(await createOk(fiveK(1200)));
      const res = await patchEffort(effort.id, { durationS: 1150 });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<Effort>()).toMatchObject({
        durationS: 1150,
        actualDistanceM: 5000,
        paceSPerKm: 230,
        isTolerance: false,
        isEdited: true,
      });
    });

    it('makes a shorter distance a tolerance result and rejects one that does not qualify', async () => {
      const effort = effortOf(await createOk(fiveK(1200)));
      const shorter = await patchEffort(effort.id, { actualDistanceM: 4800 });
      expect(shorter.json<Effort>()).toMatchObject({
        actualDistanceM: 4800,
        durationS: 1200,
        paceSPerKm: 250,
        isTolerance: true,
      });

      const tooShort = await patchEffort(effort.id, { actualDistanceM: 4000 });
      expect(tooShort.statusCode).toBe(400);
      expect(tooShort.json()).toMatchObject({
        issues: [{ path: ['actualDistanceM'], code: 'effort_distance_out_of_range' }],
      });
      expect((await patchEffort(effort.id, {})).statusCode).toBe(400);
    });

    it('stores the link on the activity without marking the result as edited', async () => {
      const activity = await createOk(fiveK(1200));
      const res = await patchEffort(effortOf(activity).id, {
        activityUrl: 'https://connect.garmin.com/app/activity/1',
      });
      expect(res.json<Effort>()).toMatchObject({ isEdited: false });
      const [row] = await database.db
        .select({ url: activities.activityUrl })
        .from(activities)
        .where(eq(activities.id, activity.id));
      expect(row!.url).toBe('https://connect.garmin.com/app/activity/1');
      expect(
        (await patchEffort(effortOf(activity).id, { activityUrl: 'ftp://x' })).statusCode,
      ).toBe(400);
    });

    it('can drop the edit of a computed result, but not of a hand-entered one', async () => {
      const effort = effortOf(await createOk(fiveK(1200)));
      await patchEffort(effort.id, { durationS: 1000 });
      const reset = await app.inject({
        method: 'POST',
        url: `/api/efforts/${effort.id}/reset`,
        headers: editor,
      });
      expect(reset.statusCode, reset.body).toBe(200);
      expect(reset.json<Effort>()).toMatchObject({ durationS: 1200, isEdited: false });

      const simple = await createOk({
        mode: 'simple',
        sport: 'road_run',
        name: 'Ręczny',
        localDate: '2026-09-01',
        distanceM: 5000,
        manualEffort: { distanceKey: '5k', durationS: 1300 },
      });
      const manual = await app.inject({
        method: 'POST',
        url: `/api/efforts/${effortOf(simple).id}/reset`,
        headers: editor,
      });
      expect(manual.statusCode).toBe(409);
    });
  });

  describe('recompute all', () => {
    it('keeps edited and deleted results, fixes computed ones and drops stale ones', async () => {
      const edited = effortOf(await createOk(fiveK(1200, { name: 'Edytowany' })));
      const removed = effortOf(await createOk(fiveK(1100, { name: 'Usunięty' })));
      const computed = await createOk(fiveK(1300, { name: 'Obliczony' }));
      await patchEffort(edited.id, { durationS: 1000 });
      await app.inject({ method: 'DELETE', url: `/api/efforts/${removed.id}`, headers: editor });
      // Simulate results computed under older rules: a wrong value and a no longer valid one.
      await database.db
        .update(efforts)
        .set({ durationS: 1, paceSPerKm: 0.2 })
        .where(eq(efforts.id, effortOf(computed).id));
      await database.db.insert(efforts).values({
        activityId: computed.id,
        sport: 'road_run',
        distanceKey: '10k',
        targetM: 10000,
        actualDistanceM: 10000,
        durationS: 2000,
        paceSPerKm: 200,
        isTolerance: false,
        origin: 'computed',
      });

      const job = await recomputeAll();
      expect(job).toMatchObject({ status: 'done', processed: 3, total: 3, error: null });
      // TIMESTAMPs (DEFAULT now() and dates written from JS) read back as the real UTC time,
      // whatever the database server's system time zone.
      for (const at of [job.createdAt, job.updatedAt, job.finishedAt!]) {
        expect(Math.abs(Date.parse(at) - Date.now())).toBeLessThan(60_000);
      }

      const result = await records();
      expect(result.distances.map((d) => d.distanceKey)).toEqual(['5k']);
      expect(result.distances[0]!.entries).toMatchObject([
        { activityName: 'Edytowany', durationS: 1000, isEdited: true },
        { activityName: 'Obliczony', durationS: 1300, isEdited: false },
      ]);
      const [stillDeleted] = await database.db
        .select({ isDeleted: efforts.isDeleted })
        .from(efforts)
        .where(eq(efforts.id, removed.id));
      expect(stillDeleted!.isDeleted).toBe(true);
    });

    it('runs in chunks, resumes after an interruption and never runs twice at once', async () => {
      const created = [];
      for (const time of [1200, 1210, 1220]) created.push(await createOk(fiveK(time)));

      const start = await app.inject({
        method: 'POST',
        url: '/api/admin/recompute-all',
        headers: editor,
      });
      const job = start.json<Job>();
      expect(job).toMatchObject({ status: 'running', processed: 0, total: 3 });

      // One item per chunk: the progress is stored after each chunk.
      const first = await runJobChunk(database.db, job.id, { maxItems: 1, maxMs: 10_000 });
      expect(first).toMatchObject({ status: 'running', processed: 1 });

      // Starting again returns the running job instead of a second one.
      const again = await app.inject({
        method: 'POST',
        url: '/api/admin/recompute-all',
        headers: editor,
      });
      expect(again.statusCode).toBe(200);
      expect(again.json<Job>().id).toBe(job.id);

      // A chunk in progress elsewhere (live lease): nothing is done.
      await database.db
        .update(jobs)
        .set({ leaseUntilMs: Date.now() + 30_000 })
        .where(eq(jobs.id, job.id));
      const busy = await runJobChunk(database.db, job.id);
      expect(busy).toMatchObject({ busy: true, processed: 1 });

      // A process killed mid-chunk leaves an expired lease: the next call resumes.
      await database.db
        .update(jobs)
        .set({ leaseUntilMs: Date.now() - 1 })
        .where(eq(jobs.id, job.id));
      const second = await runJobChunk(database.db, job.id, { maxItems: 1, maxMs: 10_000 });
      expect(second).toMatchObject({ status: 'running', processed: 2 });
      const [row] = await database.db.select().from(jobs).where(eq(jobs.id, job.id));
      expect(row!.cursor).toBe(created[1]!.id);

      const latest = await app.inject({ url: '/api/admin/recompute-all', headers: editor });
      expect(latest.json<{ job: Job }>().job).toMatchObject({ id: job.id, processed: 2 });

      const last = await app.inject({
        method: 'POST',
        url: `/api/admin/jobs/${job.id}/run`,
        headers: editor,
      });
      expect(last.json<Job>()).toMatchObject({ status: 'done', processed: 3, total: 3 });
      const status = await app.inject({ url: `/api/admin/jobs/${job.id}`, headers: editor });
      expect(status.json<Job>().status).toBe('done');

      // A finished job is not run again; a new start creates a new job.
      const rerun = await runJobChunk(database.db, job.id);
      expect(rerun).toMatchObject({ status: 'done', processed: 3 });
      expect(rerun!.busy).toBeUndefined();
      const next = await app.inject({
        method: 'POST',
        url: '/api/admin/recompute-all',
        headers: editor,
      });
      expect(next.statusCode).toBe(201);
      expect(next.json<Job>().id).not.toBe(job.id);
      const running = await database.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'running'), eq(jobs.type, 'recompute_all')));
      expect(running).toHaveLength(1);
    });

    it('answers 404 for an unknown job', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/jobs/999999/run',
        headers: editor,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
