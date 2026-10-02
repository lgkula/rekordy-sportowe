import {
  effortsFromTotals,
  manualEffort,
  type DistanceKey,
  type EffortValues,
  type ManualEffortInput,
} from '@rekordy/core';
import { and, eq, inArray } from 'drizzle-orm';
import { activities, efforts } from '../db/schema';
import type { EffortRow, Executor } from './rows';

function effortColumns(values: EffortValues) {
  return {
    targetM: values.targetM,
    actualDistanceM: values.actualDistanceM,
    durationS: values.durationS,
    paceSPerKm: values.paceSPerKm,
    isTolerance: values.isTolerance,
  };
}

/** Rows that recomputation must leave alone: entered or changed by hand, or deleted. */
function isProtected(row: EffortRow): boolean {
  return row.origin === 'manual' || row.isEdited || row.isDeleted;
}

/**
 * Recomputes the `computed` efforts of an activity (PLAN.md 4.2). Called after every create
 * and edit. Manual, edited and soft-deleted results are kept as they are; only their
 * denormalised sport follows the activity.
 *
 * Activities without a stream get results from their totals (PLAN.md Q8). Activities with a
 * stream are left unchanged here: Part 4 plugs in the best-effort engine (sliding window over
 * the stream).
 */
export async function recomputeEfforts(db: Executor, activityId: number): Promise<void> {
  const [activity] = await db
    .select({
      sport: activities.sport,
      distanceM: activities.distanceM,
      durationS: activities.durationS,
      hasStream: activities.hasStream,
    })
    .from(activities)
    .where(eq(activities.id, activityId));
  if (!activity) return;

  await db.update(efforts).set({ sport: activity.sport }).where(eq(efforts.activityId, activityId));
  if (activity.hasStream) return;

  const existing = await db.select().from(efforts).where(eq(efforts.activityId, activityId));
  const protectedKeys = new Set(existing.filter(isProtected).map((row) => row.distanceKey));
  const wanted = effortsFromTotals(activity.sport, activity.distanceM, activity.durationS).filter(
    (values) => !protectedKeys.has(values.distanceKey),
  );
  const wantedKeys = new Set<string>(wanted.map((values) => values.distanceKey));

  const stale = existing.filter(
    (row) => !protectedKeys.has(row.distanceKey) && !wantedKeys.has(row.distanceKey),
  );
  if (stale.length > 0) {
    await db.delete(efforts).where(
      inArray(
        efforts.id,
        stale.map((row) => row.id),
      ),
    );
  }

  for (const values of wanted) {
    await db
      .insert(efforts)
      .values({
        activityId,
        sport: activity.sport,
        distanceKey: values.distanceKey,
        origin: 'computed',
        ...effortColumns(values),
      })
      .onDuplicateKeyUpdate({ set: effortColumns(values) });
  }
}

/** The hand-entered result of an activity (simplified form), if any. */
export async function getManualEffortInput(
  db: Executor,
  activityId: number,
): Promise<ManualEffortInput | null> {
  const [row] = await db
    .select({ distanceKey: efforts.distanceKey, durationS: efforts.durationS })
    .from(efforts)
    .where(and(eq(efforts.activityId, activityId), eq(efforts.origin, 'manual')))
    .limit(1);
  return row ? { distanceKey: row.distanceKey as DistanceKey, durationS: row.durationS } : null;
}

/**
 * Sets (or with null removes) the hand-entered result of an activity. It replaces whatever
 * result the distance had, including a soft-deleted one: entering it again is explicit.
 * The input must have been validated with `activityIssues`.
 */
export async function setManualEffort(
  db: Executor,
  activity: { id: number; sport: EffortRow['sport']; distanceM: number },
  input: ManualEffortInput | null,
): Promise<void> {
  const others = and(eq(efforts.activityId, activity.id), eq(efforts.origin, 'manual'));
  if (!input) {
    await db.delete(efforts).where(others);
    return;
  }

  const values = manualEffort(input.distanceKey, activity.distanceM, input.durationS);
  if (!values) throw new Error(`Activity ${activity.id} is too short for ${input.distanceKey}`);

  const [current] = await db.select().from(efforts).where(others).limit(1);
  if (current && current.distanceKey !== input.distanceKey) {
    await db.delete(efforts).where(eq(efforts.id, current.id));
  }

  const row = {
    sport: activity.sport,
    origin: 'manual' as const,
    isEdited: false,
    isDeleted: false,
    ...effortColumns(values),
  };
  await db
    .insert(efforts)
    .values({ activityId: activity.id, distanceKey: input.distanceKey, ...row })
    .onDuplicateKeyUpdate({ set: row });
}
