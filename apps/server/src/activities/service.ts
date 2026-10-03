import {
  activityIssues,
  DISTANCES,
  type ActivityCreate,
  type ActivityDetail,
  type ActivityListParams,
  type ActivityListResponse,
  type ActivityPatch,
  type DuplicateConflict,
  type ManualEffortInput,
  type Stream,
  type ValidationIssue,
} from '@rekordy/core';
import { asc, count, desc, eq, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client';
import { isDuplicateEntry } from '../db/errors';
import { activities, activityStreams, efforts, events } from '../db/schema';
import { eventAssignmentIssue, findOrCreateEvent } from '../events/service';
import { findHardDuplicate, findSimilarActivities } from './duplicates';
import { getManualEffortInput, recomputeEfforts, setManualEffort } from './efforts';
import { activityMessages } from './messages';
import { encodeStream } from './streams';
import {
  fromSqlDateTime,
  listColumns,
  toDetail,
  toListItem,
  toSqlDateTime,
  type Executor,
  type NewActivityRow,
} from './rows';

export async function listActivities(
  db: Db,
  query: ActivityListParams,
): Promise<ActivityListResponse> {
  const where = query.sport ? eq(activities.sport, query.sport) : undefined;
  const dir = query.dir ?? (query.sort === 'date' ? 'desc' : 'asc');
  const order = dir === 'asc' ? asc : desc;
  // The id breaks ties, so pages never overlap.
  const orderBy: SQL[] =
    query.sort === 'name'
      ? [order(activities.name), order(activities.id)]
      : query.sort === 'distance'
        ? [order(activities.distanceM), order(activities.id)]
        : [order(activities.localDate), order(activities.startTimeUtc), order(activities.id)];

  const { page, pageSize } = query;
  const [rows, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(activities)
      .where(where)
      .orderBy(...orderBy)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(activities).where(where),
  ]);
  return { items: rows.map(toListItem), total: totals?.total ?? 0, page, pageSize };
}

export async function getActivityDetail(db: Executor, id: number): Promise<ActivityDetail | null> {
  const [row] = await db.select().from(activities).where(eq(activities.id, id));
  if (!row) return null;
  const effortRows = await db
    .select()
    .from(efforts)
    .where(eq(efforts.activityId, id))
    .orderBy(asc(efforts.targetM));
  const [event] = row.eventId
    ? await db.select({ name: events.name }).from(events).where(eq(events.id, row.eventId))
    : [];
  return toDetail(row, effortRows, event?.name ?? null);
}

/**
 * Whole-activity time of a simplified entry: when it is not given and the activity is not
 * longer than the result's target, the result time covers the whole activity.
 */
function simpleDurationS(
  distanceM: number,
  durationS: number | null | undefined,
  manualEffort: ManualEffortInput,
): number | null {
  if (durationS != null) return durationS;
  return distanceM <= DISTANCES[manualEffort.distanceKey].targetM ? manualEffort.durationS : null;
}

/** Maps a validated create body to a row, the optional hand-entered result and new event. */
export function fromCreateInput(input: ActivityCreate): {
  row: NewActivityRow;
  manualEffort: ManualEffortInput | null;
  newEventName: string | null;
} {
  const common = {
    sport: input.sport,
    name: input.name,
    localDate: input.localDate,
    distanceM: input.distanceM,
    activityUrl: input.activityUrl ?? null,
  };
  if (input.mode === 'simple') {
    return {
      row: {
        ...common,
        source: 'manual_simple',
        durationS: simpleDurationS(input.distanceM, input.durationS, input.manualEffort),
      },
      manualEffort: input.manualEffort,
      newEventName: null,
    };
  }
  const newEventName = input.newEventName ?? null;
  const eventId = newEventName === null ? (input.eventId ?? null) : null;
  return {
    row: {
      ...common,
      source: 'manual',
      startTimeUtc: input.startTimeUtc ? toSqlDateTime(input.startTimeUtc) : null,
      durationS: input.durationS,
      elapsedS: input.elapsedS ?? null,
      elevationGainM: input.elevationGainM ?? null,
      // An event assignment marks the activity as a race.
      isRace: input.isRace || eventId !== null || newEventName !== null,
      isHidden: input.isHidden,
      eventId,
      editionLabel: input.editionLabel ?? null,
      notes: input.notes ?? null,
      splits: input.splits ?? null,
    },
    manualEffort: null,
    newEventName,
  };
}

export type CreateResult =
  | { ok: true; id: number }
  | { ok: false; conflict: DuplicateConflict }
  /** The chosen event does not exist or is of another sport. */
  | { ok: false; issues: ValidationIssue[] };

export type CreateOptions = {
  manualEffort?: ManualEffortInput | null;
  confirmDuplicate?: boolean;
  /** Recorded samples (imports); stored in `activity_streams` and used for the efforts. */
  stream?: Stream | null;
  /**
   * Creates (or reuses, by name) an event of the activity's sport and assigns the activity
   * to it; overrides `row.eventId`.
   */
  newEventName?: string | null;
  /** Runs after the duplicate checks, before anything is inserted (e.g. storing the file). */
  beforeInsert?: () => Promise<void>;
};

/**
 * Saves a new activity with its efforts, unless it is a duplicate (PLAN.md 4.4):
 * the same external ID / file name / file hash always blocks; a similar activity
 * (start ±2 min or same day, distance ±3%) blocks unless `confirmDuplicate` is set.
 * Shared by manual entry and the import pipelines.
 */
export async function createActivity(
  db: Db,
  row: NewActivityRow,
  options: CreateOptions = {},
): Promise<CreateResult> {
  const hardConflict = async (): Promise<CreateResult | null> => {
    const hard = await findHardDuplicate(db, row);
    return hard
      ? {
          ok: false,
          conflict: { code: 'duplicate', error: activityMessages.duplicate, ...hard },
        }
      : null;
  };

  const hard = await hardConflict();
  if (hard) return hard;

  if (!options.confirmDuplicate) {
    const similar = await findSimilarActivities(db, {
      localDate: row.localDate,
      startTimeUtc: row.startTimeUtc ? fromSqlDateTime(row.startTimeUtc) : null,
      distanceM: row.distanceM,
    });
    if (similar.length > 0) {
      return {
        ok: false,
        conflict: { code: 'similar_activity', error: activityMessages.similar, similar },
      };
    }
  }

  const newEventName = options.newEventName ?? null;
  if (newEventName === null && row.eventId != null) {
    const issue = await eventAssignmentIssue(db, row.eventId, row.sport);
    if (issue) return { ok: false, issues: [issue] };
  }

  const streamData = options.stream ? await encodeStream(options.stream) : null;
  await options.beforeInsert?.();

  try {
    const id = await db.transaction(async (tx) => {
      const eventId =
        newEventName === null ? row.eventId : await findOrCreateEvent(tx, row.sport, newEventName);
      const [inserted] = await tx
        .insert(activities)
        .values({
          ...row,
          eventId,
          isRace: row.isRace || eventId != null,
          hasStream: streamData !== null,
        })
        .$returningId();
      const activityId = inserted!.id;
      if (streamData) await tx.insert(activityStreams).values({ activityId, data: streamData });
      if (options.manualEffort) {
        await setManualEffort(
          tx,
          { id: activityId, sport: row.sport, distanceM: row.distanceM },
          options.manualEffort,
        );
      }
      await recomputeEfforts(tx, activityId);
      return activityId;
    });
    return { ok: true, id };
  } catch (error) {
    // Lost a race with a concurrent save of the same file / external ID.
    if (isDuplicateEntry(error)) {
      const conflict = await hardConflict();
      if (conflict) return conflict;
    }
    throw error;
  }
}

export type PatchResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid'; issues: ValidationIssue[] };

/** Applies a PATCH, keeps the hand-entered result consistent and recomputes efforts. */
export async function patchActivity(
  db: Db,
  id: number,
  patch: ActivityPatch,
): Promise<PatchResult> {
  const [existing] = await db.select().from(activities).where(eq(activities.id, id));
  if (!existing) return { ok: false, reason: 'not_found' };
  const currentManual = await getManualEffortInput(db, id);

  const sport = patch.sport ?? existing.sport;
  const distanceM = patch.distanceM ?? existing.distanceM;
  const manualEffort = patch.manualEffort !== undefined ? patch.manualEffort : currentManual;
  let durationS = patch.durationS !== undefined ? patch.durationS : existing.durationS;
  if (patch.manualEffort) durationS = simpleDurationS(distanceM, durationS, patch.manualEffort);
  const elapsedS = patch.elapsedS !== undefined ? patch.elapsedS : existing.elapsedS;

  const issues = activityIssues({ sport, distanceM, durationS, elapsedS, manualEffort });

  // An event assignment marks the activity as a race; an activity un-marked as a race (with
  // no event in the same request) leaves its event.
  const newEventName = patch.newEventName ?? null;
  const assigning = newEventName !== null || patch.eventId != null;
  const isRace = assigning || (patch.isRace ?? existing.isRace);
  let eventId = patch.eventId !== undefined ? patch.eventId : existing.eventId;
  if (!isRace || newEventName !== null) eventId = null;
  if (eventId !== null) {
    const issue = await eventAssignmentIssue(db, eventId, sport);
    if (issue) issues.push(issue);
  }
  if (issues.length > 0) return { ok: false, reason: 'invalid', issues };

  const {
    manualEffort: _manualEffort,
    newEventName: _newEventName,
    startTimeUtc,
    ...fields
  } = patch;
  const set: Partial<NewActivityRow> = {
    ...fields,
    isRace,
    eventId,
    durationS,
    updatedAt: new Date(),
  };
  if (startTimeUtc !== undefined) {
    set.startTimeUtc = startTimeUtc ? toSqlDateTime(startTimeUtc) : null;
  }

  await db.transaction(async (tx) => {
    if (newEventName !== null) set.eventId = await findOrCreateEvent(tx, sport, newEventName);
    await tx.update(activities).set(set).where(eq(activities.id, id));
    const manualChanged =
      patch.manualEffort !== undefined ||
      patch.distanceM !== undefined ||
      patch.sport !== undefined;
    if (manualChanged && (manualEffort || currentManual)) {
      await setManualEffort(tx, { id, sport, distanceM }, manualEffort);
    }
    await recomputeEfforts(tx, id);
  });
  return { ok: true };
}

/** Deletes an activity; its stream and efforts go with it (FK cascade). */
export async function deleteActivity(db: Db, id: number): Promise<boolean> {
  const [result] = await db.delete(activities).where(eq(activities.id, id));
  return result.affectedRows > 0;
}
