import type {
  ActivitySource,
  DuplicateConflict,
  FitImportMeta,
  ImportCheckItem,
  ImportCheckResult,
} from '@rekordy/core';
import { parseFit, type FitErrorCode } from '@rekordy/core/fit';
import { findHardDuplicate, findSimilarActivities } from '../activities/duplicates';
import { toSqlDateTime, type Executor } from '../activities/rows';
import { createActivity } from '../activities/service';
import type { Db } from '../db/client';
import { storeFitFile } from './fitFiles';

/**
 * Duplicate check of an import batch before the review (PLAN.md 4.4 and 6.2): the same
 * watch ID / file name / file hash is a duplicate; a similar start and distance is only a
 * warning that the user confirms.
 */
export async function checkImportItems(
  db: Executor,
  items: readonly ImportCheckItem[],
): Promise<ImportCheckResult[]> {
  const results: ImportCheckResult[] = [];
  for (const item of items) {
    const hard = await findHardDuplicate(db, item);
    if (hard) {
      results.push({ key: item.key, status: 'duplicate', ...hard });
      continue;
    }
    const similar =
      item.localDate && item.distanceM
        ? await findSimilarActivities(db, {
            localDate: item.localDate,
            startTimeUtc: item.startTimeUtc ?? null,
            distanceM: item.distanceM,
          })
        : [];
    results.push(
      similar.length > 0
        ? { key: item.key, status: 'similar', similar }
        : { key: item.key, status: 'new' },
    );
  }
  return results;
}

export type FitImportResult =
  | { ok: true; id: number }
  | { ok: false; reason: 'conflict'; conflict: DuplicateConflict }
  | { ok: false; reason: 'parse'; error: FitErrorCode };

/**
 * Saves an approved FIT file: the server parses it again (the client's parse is only a
 * preview), applies the user's choices from the review, stores the activity with its
 * stream and splits plus the original file, and computes the efforts.
 */
export async function importFitFile(
  db: Db,
  input: {
    storageDir: string;
    bytes: Uint8Array;
    fileName: string;
    meta: FitImportMeta;
    source?: ActivitySource;
  },
): Promise<FitImportResult> {
  const parsed = await parseFit(input.bytes, input.fileName);
  if (!parsed.ok) return { ok: false, reason: 'parse', error: parsed.error };
  const a = parsed.activity;
  const { meta } = input;

  const result = await createActivity(
    db,
    {
      sport: meta.sport,
      name: meta.name,
      startTimeUtc: toSqlDateTime(a.startTimeUtc),
      localDate: a.localDate,
      distanceM: a.distanceM,
      durationS: a.durationS,
      elapsedS: a.elapsedS ?? null,
      elevationGainM: a.elevationGainM ?? null,
      isRace: meta.isRace,
      isHidden: meta.isHidden,
      editionLabel: meta.editionLabel ?? null,
      notes: meta.notes ?? null,
      activityUrl: meta.activityUrl ?? null,
      source: input.source ?? 'fit',
      externalId: a.externalId ?? null,
      fileName: a.fileName,
      fileSha256: a.fileSha256,
      splits: a.splits ?? null,
    },
    {
      confirmDuplicate: meta.confirmDuplicate,
      stream: a.stream ?? null,
      beforeInsert: async () => {
        await storeFitFile(input.storageDir, a.localDate, a.fileSha256, input.bytes);
      },
    },
  );
  return result.ok ? result : { ok: false, reason: 'conflict', conflict: result.conflict };
}
