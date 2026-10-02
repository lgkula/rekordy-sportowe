import {
  addDays,
  isSimilarActivity,
  SIMILAR_DISTANCE_RATIO,
  type ActivityListItem,
} from '@rekordy/core';
import { and, between, eq, ne, or, type SQL } from 'drizzle-orm';
import { activities } from '../db/schema';
import { listColumns, toListItem, type Executor } from './rows';

/** Identity keys that block saving when another activity has the same value (PLAN.md 4.4). */
export type HardDuplicateKeys = {
  externalId?: string | null;
  fileName?: string | null;
  fileSha256?: string | null;
};

export type HardDuplicate = {
  field: keyof HardDuplicateKeys;
  activity: ActivityListItem;
};

/** Strongest signal first. */
const HARD_FIELDS = ['externalId', 'fileName', 'fileSha256'] as const;

/** Finds an activity with the same external ID, file name or file hash. */
export async function findHardDuplicate(
  db: Executor,
  keys: HardDuplicateKeys,
  excludeId?: number,
): Promise<HardDuplicate | null> {
  const conditions: SQL[] = [];
  for (const field of HARD_FIELDS) {
    const value = keys[field];
    if (value) conditions.push(eq(activities[field], value));
  }
  if (conditions.length === 0) return null;

  const rows = await db
    .select({
      ...listColumns,
      externalId: activities.externalId,
      fileName: activities.fileName,
      fileSha256: activities.fileSha256,
    })
    .from(activities)
    .where(
      and(or(...conditions), excludeId === undefined ? undefined : ne(activities.id, excludeId)),
    )
    .limit(HARD_FIELDS.length);

  for (const field of HARD_FIELDS) {
    const row = keys[field] ? rows.find((r) => r[field] === keys[field]) : undefined;
    if (row) return { field, activity: toListItem(row) };
  }
  return null;
}

export type SimilarQuery = {
  localDate: string;
  startTimeUtc: string | null;
  distanceM: number;
};

/** Activities that look like the same one (start ±2 min or same day, distance ±3%). */
export async function findSimilarActivities(
  db: Executor,
  candidate: SimilarQuery,
  excludeId?: number,
): Promise<ActivityListItem[]> {
  const margin = candidate.distanceM * SIMILAR_DISTANCE_RATIO;
  // Coarse SQL filter (±1 day covers a ±2 min start around midnight), exact rule in JS.
  const rows = await db
    .select(listColumns)
    .from(activities)
    .where(
      and(
        between(
          activities.localDate,
          addDays(candidate.localDate, -1),
          addDays(candidate.localDate, 1),
        ),
        between(activities.distanceM, candidate.distanceM - margin, candidate.distanceM + margin),
        excludeId === undefined ? undefined : ne(activities.id, excludeId),
      ),
    )
    .orderBy(activities.localDate, activities.id)
    .limit(50);

  return rows.map(toListItem).filter((existing) => isSimilarActivity(candidate, existing));
}
