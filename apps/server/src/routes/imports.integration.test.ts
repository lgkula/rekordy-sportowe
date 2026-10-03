import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  FIT_MAX_FILE_BYTES,
  type ActivityDetail,
  type DuplicateConflict,
  type FitImportMetaInput,
  type ImportCheckItem,
  type ImportCheckResponse,
} from '@rekordy/core';
import { parseFit, type FitActivity } from '@rekordy/core/fit';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadStream } from '../activities/streams';
import { buildApp } from '../app';
import type { Database } from '../db/client';
import { activityStreams } from '../db/schema';
import { fitFilePath } from '../imports/fitFiles';
import { loginHeaders, testAuth } from '../test/auth';
import { clearActivityData, openTestDatabase, testDbName } from '../test/db';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../packages/core/test/fixtures');

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path.join(FIXTURES, name)));
}

/** multipart/form-data body with an optional `meta` JSON field and a `file`. */
function multipartBody(file: { name: string; bytes: Uint8Array } | null, meta?: unknown) {
  const boundary = '----rekordy-test-boundary';
  const chunks: Buffer[] = [];
  if (meta !== undefined) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${
          typeof meta === 'string' ? meta : JSON.stringify(meta)
        }\r\n`,
      ),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      ),
      Buffer.from(file.bytes),
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe.skipIf(!testDbName)('/api/import', () => {
  let database: Database;
  let app: FastifyInstance;
  let storageDir: string;
  let editor: { cookie: string };
  let viewer: { cookie: string };

  async function parsed(name: string, fileName = name): Promise<FitActivity> {
    const result = await parseFit(await fixture(name), fileName);
    if (!result.ok) throw new Error(result.error);
    return result.activity;
  }

  function checkItem(a: FitActivity, key = a.fileName): ImportCheckItem {
    return {
      key,
      fileName: a.fileName,
      fileSha256: a.fileSha256,
      externalId: a.externalId ?? null,
      startTimeUtc: a.startTimeUtc,
      localDate: a.localDate,
      distanceM: a.distanceM,
    };
  }

  async function check(items: ImportCheckItem[], headers = editor) {
    return app.inject({
      method: 'POST',
      url: '/api/import/check',
      headers,
      payload: { items },
    });
  }

  async function upload(
    file: { name: string; bytes: Uint8Array } | null,
    meta?: FitImportMetaInput | string,
    headers = editor,
  ) {
    const body = multipartBody(file, meta);
    return app.inject({
      method: 'POST',
      url: '/api/import/fit',
      headers: { ...headers, ...body.headers },
      payload: body.payload,
    });
  }

  const raceMeta = {
    name: 'Bieg Jesienny',
    sport: 'road_run',
    isRace: true,
    activityUrl: 'https://connect.garmin.com/modern/activity/1',
    notes: 'Mokro',
  } satisfies FitImportMetaInput;

  beforeAll(async () => {
    database = await openTestDatabase();
    storageDir = await mkdtemp(path.join(tmpdir(), 'rekordy-storage-'));
    app = await buildApp({
      webDir: path.join(tmpdir(), 'rekordy-no-web'),
      health: {
        checkDb: async () => {},
        migrationStatus: async () => ({ total: 0, applied: 0, pending: [] }),
        checkStorage: async () => true,
      },
      auth: testAuth(),
      db: database.db,
      storageDir,
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
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it('imports a race: server-side parse, review choices, splits, stream, efforts, file', async () => {
    const bytes = await fixture('race-1.fit');
    const res = await upload({ name: 'race-1.fit', bytes }, raceMeta);
    expect(res.statusCode, res.body).toBe(201);
    const activity = res.json<ActivityDetail>();
    expect(activity).toMatchObject({
      sport: 'road_run',
      name: 'Bieg Jesienny',
      localDate: '2026-09-27',
      startTimeUtc: '2026-09-27T10:00:10.000Z',
      distanceM: 9730.4,
      durationS: 3154.9,
      elapsedS: 3154.9,
      elevationGainM: 12,
      isRace: true,
      isHidden: false,
      source: 'fit',
      fileName: 'race-1.fit',
      externalId: 'garmin:1000000001:1790503210',
      activityUrl: 'https://connect.garmin.com/modern/activity/1',
      notes: 'Mokro',
      hasStream: true,
    });
    expect(activity.splits).toHaveLength(10);
    expect(activity.splits!.at(-1)).toMatchObject({ partial: true, distanceM: 730.4 });
    expect(activity.efforts.map((e) => [e.distanceKey, e.isTolerance])).toEqual([
      ['1k', false],
      ['5k', false],
      ['10k', true],
    ]);

    const stream = await loadStream(database.db, activity.id);
    expect(stream!.t.length).toBeGreaterThan(900);

    const sha = (await parsed('race-1.fit')).fileSha256;
    const stored = await readFile(fitFilePath(storageDir, '2026', sha));
    expect(Buffer.compare(gunzipSync(stored), Buffer.from(bytes))).toBe(0);
  });

  it('never trusts the client: totals come from the file, only review fields from meta', async () => {
    const res = await upload(
      { name: 'race-2-mountain.fit', bytes: await fixture('race-2-mountain.fit') },
      { name: 'Górski', sport: 'trail_run', isRace: false, isHidden: true },
    );
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json<ActivityDetail>()).toMatchObject({
      sport: 'trail_run',
      isRace: false,
      isHidden: true,
      distanceM: 10301,
      elevationGainM: 346,
    });
  });

  it('assigns the event chosen in the review, creating it once for several files', async () => {
    const meta = { ...raceMeta, newEventName: 'Bieg Jesienny', editionLabel: '2026' };
    const first = await upload({ name: 'race-1.fit', bytes: await fixture('race-1.fit') }, meta);
    expect(first.statusCode, first.body).toBe(201);
    const second = await upload(
      { name: 'race-3.fit', bytes: await fixture('race-3.fit') },
      { ...meta, editionLabel: 'jesień', confirmDuplicate: true },
    );
    expect(second.statusCode, second.body).toBe(201);
    const [a, b] = [first.json<ActivityDetail>(), second.json<ActivityDetail>()];
    expect(a).toMatchObject({ eventName: 'Bieg Jesienny', editionLabel: '2026' });
    expect(b.eventId).toBe(a.eventId);

    const wrongSport = await upload(
      { name: 'race-2-mountain.fit', bytes: await fixture('race-2-mountain.fit') },
      { ...raceMeta, sport: 'trail_run', eventId: a.eventId },
    );
    expect(wrongSport.statusCode, wrongSport.body).toBe(400);
  });

  it('checks a batch for duplicates by watch ID, file name and hash', async () => {
    const race = await parsed('race-1.fit');
    const training = await parsed('training-1.fit');
    const before = await check([checkItem(race), checkItem(training)]);
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json<ImportCheckResponse>().results).toEqual([
      { key: 'race-1.fit', status: 'new' },
      { key: 'training-1.fit', status: 'new' },
    ]);

    await upload({ name: 'race-1.fit', bytes: await fixture('race-1.fit') }, raceMeta);
    const renamed = await parsed('race-1.fit', 'kopia.fit');
    const sameName = { ...checkItem(training, 'other'), fileName: 'race-1.fit' };
    const sameHash = { ...checkItem(training, 'hash'), fileSha256: race.fileSha256 };
    const after = await check([checkItem(race), checkItem(renamed), sameName, sameHash]);
    const results = after.json<ImportCheckResponse>().results;
    expect(results.map((r) => [r.key, r.status, r.status === 'duplicate' && r.field])).toEqual([
      ['race-1.fit', 'duplicate', 'externalId'],
      ['kopia.fit', 'duplicate', 'externalId'],
      ['other', 'duplicate', 'fileName'],
      ['hash', 'duplicate', 'fileSha256'],
    ]);
  });

  it('rejects importing the same file again, also renamed', async () => {
    const bytes = await fixture('race-3.fit');
    expect((await upload({ name: 'race-3.fit', bytes }, raceMeta)).statusCode).toBe(201);
    for (const name of ['race-3.fit', 'kopia zawodów.fit']) {
      const res = await upload({ name, bytes }, { ...raceMeta, confirmDuplicate: true });
      expect(res.statusCode, res.body).toBe(409);
      expect(res.json<DuplicateConflict>()).toMatchObject({ code: 'duplicate' });
    }
  });

  it('warns about a similar activity and saves it once confirmed', async () => {
    const training = await parsed('training-2.fit');
    const manual = await app.inject({
      method: 'POST',
      url: '/api/activities',
      headers: editor,
      payload: {
        mode: 'full',
        sport: 'road_run',
        name: 'Wpisany ręcznie',
        localDate: training.localDate,
        startTimeUtc: training.startTimeUtc,
        distanceM: 9600,
        durationS: 4560,
      },
    });
    expect(manual.statusCode, manual.body).toBe(201);

    const result = (await check([checkItem(training)])).json<ImportCheckResponse>().results[0]!;
    expect(result.status).toBe('similar');

    const file = { name: 'training-2.fit', bytes: await fixture('training-2.fit') };
    const meta = { name: 'Bieg', sport: 'road_run', isRace: false } as const;
    const blocked = await upload(file, meta);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json<DuplicateConflict>().code).toBe('similar_activity');
    expect((await upload(file, { ...meta, confirmDuplicate: true })).statusCode).toBe(201);
  });

  it('recomputes stream efforts after an edit', async () => {
    const res = await upload(
      { name: 'race-3.fit', bytes: await fixture('race-3.fit') },
      { ...raceMeta, sport: 'road_run' },
    );
    const { id } = res.json<ActivityDetail>();
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/activities/${id}`,
      headers: editor,
      payload: { sport: 'trail_run' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const detail = patched.json<ActivityDetail>();
    expect(detail.efforts.map((e) => [e.distanceKey, e.sport, e.isTolerance])).toEqual([
      ['1k', 'trail_run', false],
      ['5k', 'trail_run', false],
      ['10k', 'trail_run', false],
    ]);
  });

  it('answers 422 with a code for a corrupt or unsupported file', async () => {
    const bytes = await fixture('race-1.fit');
    const cut = await upload({ name: 'cut.fit', bytes: bytes.slice(0, 5000) }, raceMeta);
    expect(cut.statusCode).toBe(422);
    expect(cut.json()).toMatchObject({ code: 'corrupt', error: 'Plik FIT jest uszkodzony.' });

    const text = await upload({ name: 'a.fit', bytes: new TextEncoder().encode('nope') }, raceMeta);
    expect(text.json()).toMatchObject({ code: 'not_fit' });
  });

  it('validates the request', async () => {
    const file = { name: 'race-1.fit', bytes: await fixture('race-1.fit') };
    expect((await upload(null, raceMeta)).statusCode).toBe(400);
    expect((await upload(file)).statusCode).toBe(400);
    expect((await upload(file, 'not json')).statusCode).toBe(400);
    const invalid = await upload(file, { ...raceMeta, name: '' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ issues: [{ path: ['name'], code: 'required' }] });

    const big = await upload(
      { name: 'big.fit', bytes: new Uint8Array(FIT_MAX_FILE_BYTES + 1) },
      raceMeta,
    );
    expect(big.statusCode).toBe(413);
    // Nothing was saved.
    expect(await database.db.select().from(activityStreams)).toEqual([]);
  });

  it('is editor only', async () => {
    const race = await parsed('race-1.fit');
    expect((await check([checkItem(race)], viewer)).statusCode).toBe(403);
    const file = { name: 'race-1.fit', bytes: await fixture('race-1.fit') };
    expect((await upload(file, raceMeta, viewer)).statusCode).toBe(403);
  });

  it('removes the stream with the activity', async () => {
    const res = await upload({ name: 'race-1.fit', bytes: await fixture('race-1.fit') }, raceMeta);
    const { id } = res.json<ActivityDetail>();
    await app.inject({ method: 'DELETE', url: `/api/activities/${id}`, headers: editor });
    const rows = await database.db
      .select()
      .from(activityStreams)
      .where(eq(activityStreams.activityId, id));
    expect(rows).toEqual([]);
  });
});
