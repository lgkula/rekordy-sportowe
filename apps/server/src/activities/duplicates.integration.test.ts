import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../db/client';
import { activities } from '../db/schema';
import { clearActivityData, openTestDatabase, testDbName } from '../test/db';
import { findHardDuplicate, findSimilarActivities } from './duplicates';
import type { NewActivityRow } from './rows';
import { createActivity } from './service';

describe.skipIf(!testDbName)('duplicate detection (database)', () => {
  let database: Database;

  const base: NewActivityRow = {
    sport: 'road_run',
    name: 'Morning Run',
    localDate: '2026-09-12',
    startTimeUtc: '2026-09-12 07:00:00',
    distanceM: 10000,
    durationS: 3000,
    source: 'fit',
  };

  async function insert(row: Partial<NewActivityRow>): Promise<number> {
    const [inserted] = await database.db
      .insert(activities)
      .values({ ...base, ...row })
      .$returningId();
    return inserted!.id;
  }

  beforeAll(async () => {
    database = await openTestDatabase();
  });

  beforeEach(async () => {
    await clearActivityData(database);
  });

  afterAll(async () => {
    await database?.close();
  });

  describe('hard duplicates', () => {
    it('finds the same external ID, file name or file hash', async () => {
      const id = await insert({
        externalId: 'garmin:123:456',
        fileName: 'a.fit',
        fileSha256: 'a'.repeat(64),
      });
      const { db } = database;
      expect(await findHardDuplicate(db, { externalId: 'garmin:123:456' })).toMatchObject({
        field: 'externalId',
        activity: { id, name: 'Morning Run' },
      });
      expect(await findHardDuplicate(db, { fileName: 'a.fit' })).toMatchObject({
        field: 'fileName',
      });
      expect(await findHardDuplicate(db, { fileSha256: 'a'.repeat(64) })).toMatchObject({
        field: 'fileSha256',
      });
    });

    it('reports the strongest signal first and ignores missing keys', async () => {
      await insert({ externalId: 'strava:1', fileName: 'b.fit' });
      const { db } = database;
      expect(
        (await findHardDuplicate(db, { externalId: 'strava:1', fileName: 'b.fit' }))?.field,
      ).toBe('externalId');
      expect(await findHardDuplicate(db, { externalId: 'strava:2', fileName: null })).toBeNull();
      expect(await findHardDuplicate(db, {})).toBeNull();
    });

    it('can exclude the activity itself', async () => {
      const id = await insert({ fileName: 'c.fit' });
      expect(await findHardDuplicate(database.db, { fileName: 'c.fit' }, id)).toBeNull();
    });

    it('blocks createActivity even with confirmDuplicate', async () => {
      await insert({ externalId: 'strava:7' });
      const result = await createActivity(
        database.db,
        { ...base, localDate: '2025-01-01', startTimeUtc: null, externalId: 'strava:7' },
        { confirmDuplicate: true },
      );
      expect(result).toMatchObject({
        ok: false,
        conflict: { code: 'duplicate', field: 'externalId' },
      });
    });
  });

  describe('similar activities', () => {
    it('matches a start within ±2 min and a distance within ±3%', async () => {
      const id = await insert({ startTimeUtc: '2026-09-12 07:01:30', distanceM: 10250 });
      await insert({ startTimeUtc: '2026-09-12 07:03:00' }); // 3 min later
      await insert({ distanceM: 10400 }); // 4% longer
      await insert({ sport: 'trail_run', startTimeUtc: '2026-09-12 06:59:00', distanceM: 9800 });

      const similar = await findSimilarActivities(database.db, {
        localDate: '2026-09-12',
        startTimeUtc: '2026-09-12T07:00:00.000Z',
        distanceM: 10000,
      });
      expect(similar.map((a) => a.distanceM).sort((a, b) => a - b)).toEqual([9800, 10250]);
      expect(similar.some((a) => a.id === id)).toBe(true);
    });

    it('matches a start around midnight on the neighbouring date', async () => {
      await insert({ localDate: '2026-09-13', startTimeUtc: '2026-09-12 22:01:00' });
      const similar = await findSimilarActivities(database.db, {
        localDate: '2026-09-12',
        startTimeUtc: '2026-09-12T22:00:00.000Z',
        distanceM: 10000,
      });
      expect(similar).toHaveLength(1);
    });

    it('uses the same day when a start time is unknown', async () => {
      await insert({ startTimeUtc: null });
      await insert({ localDate: '2026-09-11', startTimeUtc: null });
      const similar = await findSimilarActivities(database.db, {
        localDate: '2026-09-12',
        startTimeUtc: '2026-09-12T15:00:00.000Z',
        distanceM: 10100,
      });
      expect(similar.map((a) => a.localDate)).toEqual(['2026-09-12']);
    });

    it('can exclude the activity itself', async () => {
      const id = await insert({});
      const similar = await findSimilarActivities(
        database.db,
        { localDate: '2026-09-12', startTimeUtc: null, distanceM: 10000 },
        id,
      );
      expect(similar).toEqual([]);
    });
  });
});
