import {
  editedEffort,
  RECORDS_TOP_N,
  sportDistances,
  type DeletedEffort,
  type DistanceKey,
  type DistanceRecords,
  type Effort,
  type EffortPatch,
  type RecordEntry,
  type RecordsResponse,
  type Sport,
  type ValidationIssue,
} from '@rekordy/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { recomputeEfforts } from '../activities/efforts';
import { toEffort, type Executor } from '../activities/rows';
import type { Db } from '../db/client';
import { activities, efforts } from '../db/schema';

/** Effort + activity columns shown in the records view and the deleted list. */
const entryColumns = {
  effortId: efforts.id,
  activityId: efforts.activityId,
  activityName: activities.name,
  localDate: activities.localDate,
  activityUrl: activities.activityUrl,
  sport: efforts.sport,
  distanceKey: efforts.distanceKey,
  paceSPerKm: efforts.paceSPerKm,
  durationS: efforts.durationS,
  actualDistanceM: efforts.actualDistanceM,
  isTolerance: efforts.isTolerance,
  origin: efforts.origin,
  isEdited: efforts.isEdited,
  updatedAt: efforts.updatedAt,
};

function selectEntries(db: Db) {
  return db
    .select(entryColumns)
    .from(efforts)
    .innerJoin(activities, eq(activities.id, efforts.activityId))
    .$dynamic();
}

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number];

function toRecordEntry(row: EntryRow): RecordEntry {
  return {
    effortId: row.effortId,
    activityId: row.activityId,
    activityName: row.activityName,
    localDate: row.localDate,
    activityUrl: row.activityUrl,
    paceSPerKm: row.paceSPerKm,
    // Tolerance results show the pace only (D2).
    durationS: row.isTolerance ? null : row.durationS,
    actualDistanceM: row.actualDistanceM,
    isTolerance: row.isTolerance,
    origin: row.origin,
    isEdited: row.isEdited,
  };
}

/**
 * Records of a sport (PLAN.md 4.2): per distance the best results by pace, the earlier
 * activity first on a tie. Hidden activities and deleted results do not count; distances
 * without results are left out.
 */
export async function getRecords(db: Db, sport: Sport): Promise<RecordsResponse> {
  const perDistance = await Promise.all(
    sportDistances(sport).map(async ({ key, targetM }): Promise<DistanceRecords> => {
      const rows = await selectEntries(db)
        .where(
          and(
            eq(efforts.sport, sport),
            eq(efforts.distanceKey, key),
            eq(efforts.isDeleted, false),
            eq(activities.isHidden, false),
          ),
        )
        .orderBy(
          asc(efforts.paceSPerKm),
          asc(activities.localDate),
          asc(activities.startTimeUtc),
          asc(efforts.id),
        )
        .limit(RECORDS_TOP_N);
      return { distanceKey: key, targetM, entries: rows.map(toRecordEntry) };
    }),
  );
  return { sport, distances: perDistance.filter((d) => d.entries.length > 0) };
}

/** Soft-deleted results, most recently deleted first (admin page, to restore them). */
export async function listDeletedEfforts(db: Db, sport?: Sport): Promise<DeletedEffort[]> {
  const rows = await selectEntries(db)
    .where(and(eq(efforts.isDeleted, true), sport ? eq(efforts.sport, sport) : undefined))
    .orderBy(desc(efforts.updatedAt), desc(efforts.id))
    .limit(500);
  return rows.map((row) => ({
    ...toRecordEntry(row),
    sport: row.sport,
    distanceKey: row.distanceKey as DistanceKey,
    durationS: row.durationS,
    deletedAt: row.updatedAt.toISOString(),
  }));
}

async function findEffort(db: Executor, id: number) {
  const [row] = await db.select().from(efforts).where(eq(efforts.id, id));
  return row ?? null;
}

export type EffortChangeResult =
  | { ok: true; effort: Effort | null }
  | { ok: false; reason: 'not_found' | 'not_computed' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] };

/**
 * Edits a result by hand (PLAN.md 4.2). A new time or distance is checked with the totals
 * rule (`editedEffort`), recalculates pace and tolerance, and marks the result as edited so
 * that recomputation keeps it. The link belongs to the activity.
 */
export async function patchEffort(
  db: Db,
  id: number,
  patch: EffortPatch,
): Promise<EffortChangeResult> {
  const row = await findEffort(db, id);
  if (!row) return { ok: false, reason: 'not_found' };

  const valuesChanged = patch.durationS !== undefined || patch.actualDistanceM !== undefined;
  const values = valuesChanged
    ? editedEffort(
        row.distanceKey as DistanceKey,
        patch.actualDistanceM ?? row.actualDistanceM,
        patch.durationS ?? row.durationS,
      )
    : null;
  if (valuesChanged && !values) {
    return {
      ok: false,
      reason: 'invalid',
      issues: [{ path: ['actualDistanceM'], code: 'effort_distance_out_of_range' }],
    };
  }

  await db.transaction(async (tx) => {
    if (patch.activityUrl !== undefined) {
      await tx
        .update(activities)
        .set({ activityUrl: patch.activityUrl, updatedAt: new Date() })
        .where(eq(activities.id, row.activityId));
    }
    if (values) {
      await tx
        .update(efforts)
        .set({
          actualDistanceM: values.actualDistanceM,
          durationS: values.durationS,
          paceSPerKm: values.paceSPerKm,
          isTolerance: values.isTolerance,
          isEdited: true,
        })
        .where(eq(efforts.id, id));
    }
  });
  const updated = await findEffort(db, id);
  return { ok: true, effort: updated && toEffort(updated) };
}

/** Soft delete: the next result moves up, and recomputation does not bring it back. */
export async function deleteEffort(db: Db, id: number): Promise<boolean> {
  const [result] = await db.update(efforts).set({ isDeleted: true }).where(eq(efforts.id, id));
  return result.affectedRows > 0;
}

/**
 * Brings a deleted result back. A computed result that was not edited is recomputed, so it
 * reflects the current rules (and disappears if the activity no longer qualifies).
 */
export async function restoreEffort(db: Db, id: number): Promise<EffortChangeResult> {
  const row = await findEffort(db, id);
  if (!row) return { ok: false, reason: 'not_found' };
  await db.transaction(async (tx) => {
    await tx.update(efforts).set({ isDeleted: false }).where(eq(efforts.id, id));
    if (row.origin === 'computed' && !row.isEdited) await recomputeEfforts(tx, row.activityId);
  });
  const restored = await findEffort(db, id);
  return { ok: true, effort: restored && toEffort(restored) };
}

/**
 * Drops a manual edit of a computed result: it is recomputed from the activity again (and
 * removed if the activity no longer qualifies). Results entered by hand have nothing to go
 * back to.
 */
export async function resetEffort(db: Db, id: number): Promise<EffortChangeResult> {
  const row = await findEffort(db, id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.origin !== 'computed') return { ok: false, reason: 'not_computed' };
  await db.transaction(async (tx) => {
    await tx.update(efforts).set({ isEdited: false }).where(eq(efforts.id, id));
    await recomputeEfforts(tx, row.activityId);
  });
  const reset = await findEffort(db, id);
  return { ok: true, effort: reset && toEffort(reset) };
}
