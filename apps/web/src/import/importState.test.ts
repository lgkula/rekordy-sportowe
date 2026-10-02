import type { ActivityListItem } from '@rekordy/core';
import type { FitActivity, FitParseResult } from '@rekordy/core/fit';
import { describe, expect, it } from 'vitest';
import {
  applyCheckResult,
  applyParseResult,
  approvableWithoutReview,
  isBusy,
  markBatchDuplicates,
  newItem,
  reviewQueue,
  summarize,
  toCheckItem,
  toMeta,
  type ImportItem,
} from './importState';

function activity(overrides: Partial<FitActivity> = {}): FitActivity {
  return {
    sport: 'road_run',
    name: 'Bieg zawody 27.09.2026',
    startTimeUtc: '2026-09-27T10:00:10.000Z',
    localDate: '2026-09-27',
    distanceM: 9730.4,
    durationS: 3154.9,
    isRace: true,
    isRaceConfidence: 'fit',
    externalId: 'garmin:1:1790503210',
    fileName: 'race.fit',
    fileSha256: 'a'.repeat(64),
    ...overrides,
  };
}

function parsedItem(name: string, overrides: Partial<FitActivity> = {}): ImportItem {
  const result: FitParseResult = {
    ok: true,
    activity: activity({ fileName: name, ...overrides }),
    details: {
      sportProfileName: 'Bieg zawody',
      fitSport: 'running',
      fitSubSport: 'generic',
      sportSource: 'sport',
      raceSource: 'profile_name',
      utcOffsetS: 7200,
    },
  };
  return applyParseResult(newItem(new File([], name)), result);
}

const existing = { id: 7, name: 'Parkrun', localDate: '2026-09-27' } as ActivityListItem;

describe('import state', () => {
  it('prefills the review from the parse and waits for the duplicate check', () => {
    const item = parsedItem('race.fit');
    expect(item.status).toBe('checking');
    expect(item.values).toEqual({
      name: 'Bieg zawody 27.09.2026',
      sport: 'road_run',
      isRace: true,
      isHidden: false,
      activityUrl: '',
      notes: '',
      confirmSimilar: false,
    });
    expect(toCheckItem(item)).toEqual({
      key: item.key,
      fileName: 'race.fit',
      fileSha256: 'a'.repeat(64),
      externalId: 'garmin:1:1790503210',
      startTimeUtc: '2026-09-27T10:00:10.000Z',
      localDate: '2026-09-27',
      distanceM: 9730.4,
    });
  });

  it('maps parse failures to final statuses', () => {
    const file = new File([], 'bike.fit');
    expect(
      applyParseResult(newItem(file), {
        ok: false,
        error: 'unsupported_sport',
        fileName: 'bike.fit',
        fileSha256: 'b'.repeat(64),
        fitSport: 'cycling',
      }),
    ).toMatchObject({ status: 'unsupported', fitSport: 'cycling' });
    expect(
      applyParseResult(newItem(file), {
        ok: false,
        error: 'corrupt',
        fileName: 'bike.fit',
        fileSha256: 'b'.repeat(64),
      }),
    ).toMatchObject({ status: 'error', error: 'corrupt' });
  });

  it('marks a file dropped twice (or a renamed copy) as a duplicate in the batch', () => {
    const first = parsedItem('race.fit');
    const copy = parsedItem('kopia.fit');
    const other = parsedItem('other.fit', {
      externalId: 'garmin:1:2',
      fileSha256: 'c'.repeat(64),
    });
    const marked = markBatchDuplicates([first, copy, other]);
    expect(marked.map((i) => i.status)).toEqual(['checking', 'duplicate', 'checking']);
    expect(marked[1]!.duplicate).toEqual({ field: 'externalId', sameAsFile: 'race.fit' });
  });

  it('compares new files with files of an earlier drop too', () => {
    const saved = { ...parsedItem('race.fit'), status: 'saved' as const };
    const skipped = {
      ...parsedItem('other.fit', { fileSha256: 'c'.repeat(64), externalId: 'x' }),
      status: 'skipped' as const,
    };
    const again = parsedItem('race.fit');
    const otherAgain = parsedItem('other.fit', { fileSha256: 'c'.repeat(64), externalId: 'x' });
    const marked = markBatchDuplicates([saved, skipped, again, otherAgain]);
    expect(marked[2]!.status).toBe('duplicate');
    // A skipped file can be added again for review.
    expect(marked[3]!.status).toBe('checking');
  });

  it('applies the server check', () => {
    const item = parsedItem('race.fit');
    expect(applyCheckResult(item, { key: item.key, status: 'new' }).status).toBe('new');
    expect(
      applyCheckResult(item, { key: item.key, status: 'similar', similar: [existing] }),
    ).toMatchObject({ status: 'similar', similar: [existing] });
    expect(
      applyCheckResult(item, {
        key: item.key,
        status: 'duplicate',
        field: 'fileSha256',
        activity: existing,
      }),
    ).toMatchObject({
      status: 'duplicate',
      duplicate: { field: 'fileSha256', activity: existing },
    });
  });

  it('queues new and similar files; approve-all skips unconfirmed similar ones', () => {
    const fresh = { ...parsedItem('a.fit'), status: 'new' as const };
    const similar = { ...parsedItem('b.fit'), status: 'similar' as const };
    const confirmed = {
      ...similar,
      key: 'confirmed',
      values: { ...similar.values!, confirmSimilar: true },
    };
    const saved = { ...parsedItem('c.fit'), status: 'saved' as const };
    const items = [fresh, similar, confirmed, saved];
    expect(reviewQueue(items)).toEqual([fresh, similar, confirmed]);
    expect(approvableWithoutReview(items)).toEqual([fresh, confirmed]);
    expect(isBusy(items)).toBe(false);
    expect(isBusy([...items, { ...fresh, status: 'uploading' }])).toBe(true);
  });

  it('builds the upload meta and reports invalid fields', () => {
    const values = parsedItem('a.fit').values!;
    expect(
      toMeta({ ...values, activityUrl: ' https://www.strava.com/activities/1 ' }, false),
    ).toEqual({
      ok: true,
      meta: {
        name: 'Bieg zawody 27.09.2026',
        sport: 'road_run',
        isRace: true,
        isHidden: false,
        activityUrl: 'https://www.strava.com/activities/1',
        notes: null,
      },
    });
    expect(toMeta({ ...values, confirmSimilar: true }, true)).toMatchObject({
      ok: true,
      meta: { confirmDuplicate: true, activityUrl: null },
    });
    expect(toMeta({ ...values, name: ' ', activityUrl: 'garmin' }, false)).toEqual({
      ok: false,
      errors: { name: 'required', activityUrl: 'invalid_url' },
    });
  });

  it('summarises the import', () => {
    const items: ImportItem[] = [
      { ...parsedItem('a.fit'), status: 'saved' },
      { ...parsedItem('b.fit'), status: 'saved' },
      { ...parsedItem('c.fit'), status: 'duplicate' },
      { ...parsedItem('d.fit'), status: 'new' },
    ];
    expect(summarize(items)).toEqual({
      saved: 2,
      skipped: 0,
      duplicate: 1,
      error: 0,
      unsupported: 0,
      pending: 1,
    });
  });
});
