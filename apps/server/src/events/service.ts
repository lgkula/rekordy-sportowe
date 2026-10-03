import {
  aggregateEvent,
  compareEditions,
  editionPace,
  sameEventName,
  sortEventList,
  suggestEvents,
  type EventCreate,
  type EventDetail,
  type EventEdition,
  type EventListItem,
  type EventListResponse,
  type EventSuggestion,
  type Sport,
  type ValidationIssue,
} from '@rekordy/core';
import { and, eq, inArray, isNull, max } from 'drizzle-orm';
import { fromSqlDateTime, type Executor } from '../activities/rows';
import type { Db } from '../db/client';
import { activities, events } from '../db/schema';
import { getEventOrdering } from './settings';

type EventRow = typeof events.$inferSelect;

/** Activity columns of an edition. */
const editionColumns = {
  activityId: activities.id,
  activityName: activities.name,
  editionLabel: activities.editionLabel,
  localDate: activities.localDate,
  startTimeUtc: activities.startTimeUtc,
  distanceM: activities.distanceM,
  durationS: activities.durationS,
  elevationGainM: activities.elevationGainM,
  isHidden: activities.isHidden,
};

type EditionRow = {
  activityId: number;
  activityName: string;
  editionLabel: string | null;
  localDate: string;
  startTimeUtc: string | null;
  distanceM: number;
  durationS: number | null;
  elevationGainM: number | null;
  isHidden: boolean;
};

function toEdition(row: EditionRow): EventEdition {
  return {
    ...row,
    startTimeUtc: row.startTimeUtc ? fromSqlDateTime(row.startTimeUtc) : null,
    paceSPerKm: editionPace(row.distanceM, row.durationS),
  };
}

function eventItem(row: EventRow, editions: readonly EventEdition[]): EventListItem {
  return {
    key: `e${row.id}`,
    id: row.id,
    activityId: null,
    sport: row.sport,
    name: row.name,
    displayDistanceM: row.displayDistanceM,
    sortOrder: row.sortOrder,
    ...aggregateEvent(row.sport, editions, row.displayDistanceM),
  };
}

/** A race without an event, listed as a one-edition event of its own. */
function unassignedItem(sport: Sport, edition: EventEdition): EventListItem {
  return {
    key: `a${edition.activityId}`,
    id: null,
    activityId: edition.activityId,
    sport,
    name: edition.activityName,
    displayDistanceM: null,
    sortOrder: null,
    ...aggregateEvent(sport, [edition], null),
  };
}

/**
 * The races list of a sport (PLAN.md 4.3): every event with its aggregated values, plus the
 * race activities without an event, in the saved order (manual or by name).
 */
export async function listEvents(db: Db, sport: Sport): Promise<EventListResponse> {
  const [eventRows, assigned, unassigned, ordering] = await Promise.all([
    db.select().from(events).where(eq(events.sport, sport)),
    db
      .select({ ...editionColumns, eventId: events.id })
      .from(activities)
      .innerJoin(events, eq(events.id, activities.eventId))
      .where(eq(events.sport, sport)),
    db
      .select(editionColumns)
      .from(activities)
      .where(
        and(eq(activities.sport, sport), eq(activities.isRace, true), isNull(activities.eventId)),
      ),
    getEventOrdering(db, sport),
  ]);

  const byEvent = new Map<number, EventEdition[]>();
  for (const { eventId, ...row } of assigned) {
    const list = byEvent.get(eventId) ?? [];
    list.push(toEdition(row));
    byEvent.set(eventId, list);
  }
  const items = [
    ...eventRows.map((row) => eventItem(row, byEvent.get(row.id) ?? [])),
    ...unassigned.map((row) => unassignedItem(sport, toEdition(row))),
  ];
  return { sport, ordering, events: sortEventList(items, ordering) };
}

/** An event with its editions, newest first. */
export async function getEvent(db: Executor, id: number): Promise<EventDetail | null> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  if (!row) return null;
  const rows = await db.select(editionColumns).from(activities).where(eq(activities.eventId, id));
  const editions = rows.map(toEdition).sort(compareEditions);
  return { ...eventItem(row, editions), id: row.id, editions };
}

async function nextSortOrder(db: Executor, sport: Sport): Promise<number> {
  const [row] = await db
    .select({ last: max(events.sortOrder) })
    .from(events)
    .where(eq(events.sport, sport));
  return row?.last == null ? 0 : row.last + 1;
}

async function insertEvent(
  db: Executor,
  sport: Sport,
  name: string,
  displayDistanceM: number | null = null,
): Promise<number> {
  const [inserted] = await db
    .insert(events)
    .values({ sport, name, displayDistanceM, sortOrder: await nextSortOrder(db, sport) })
    .$returningId();
  return inserted!.id;
}

/**
 * The event of a new name chosen with "Utwórz nowe": an event of the sport with the same name
 * (case, diacritics and spacing aside) is reused, so that approving several files of one race
 * creates it once. A new event goes to the end of the manual order.
 */
export async function findOrCreateEvent(db: Executor, sport: Sport, name: string): Promise<number> {
  const existing = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(eq(events.sport, sport));
  const same = existing.filter((e) => sameEventName(e.name, name)).sort((a, b) => a.id - b.id);
  return same[0]?.id ?? insertEvent(db, sport, name.trim());
}

/** Checks that an existing event can take an activity of `sport`; null when it can. */
export async function eventAssignmentIssue(
  db: Executor,
  eventId: number,
  sport: Sport,
): Promise<ValidationIssue | null> {
  const [row] = await db.select({ sport: events.sport }).from(events).where(eq(events.id, eventId));
  if (!row) return { path: ['eventId'], code: 'event_not_found' };
  if (row.sport !== sport) return { path: ['eventId'], code: 'event_not_for_sport' };
  return null;
}

export type EventCreateResult = { ok: true; id: number } | { ok: false; issues: ValidationIssue[] };

/**
 * Creates an event at the end of the manual order. `activityIds` are assigned to it (they
 * must have its sport) and marked as races.
 */
export async function createEvent(db: Db, input: EventCreate): Promise<EventCreateResult> {
  const ids = [...new Set(input.activityIds ?? [])];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: activities.id, sport: activities.sport })
      .from(activities)
      .where(inArray(activities.id, ids));
    if (rows.length !== ids.length || rows.some((r) => r.sport !== input.sport)) {
      return { ok: false, issues: [{ path: ['activityIds'], code: 'event_not_for_sport' }] };
    }
  }
  const id = await db.transaction(async (tx) => {
    const eventId = await insertEvent(tx, input.sport, input.name, input.displayDistanceM ?? null);
    if (ids.length > 0) {
      await tx
        .update(activities)
        .set({ eventId, isRace: true, updatedAt: new Date() })
        .where(inArray(activities.id, ids));
    }
    return eventId;
  });
  return { ok: true, id };
}

/** Renames an event and/or sets its distance (null: computed from the editions). */
export async function patchEvent(
  db: Db,
  id: number,
  patch: { name?: string; displayDistanceM?: number | null },
): Promise<boolean> {
  const [existing] = await db.select({ id: events.id }).from(events).where(eq(events.id, id));
  if (!existing) return false;
  await db.update(events).set(patch).where(eq(events.id, id));
  return true;
}

/**
 * Deletes an event. Its editions stay as race activities without an event (FK `SET NULL`),
 * so they show up in the list as one-edition events again.
 */
export async function deleteEvent(db: Db, id: number): Promise<boolean> {
  const [result] = await db.delete(events).where(eq(events.id, id));
  return result.affectedRows > 0;
}

export type MergeResult =
  { ok: true } | { ok: false; reason: 'not_found' | 'same_event' | 'other_sport' };

/** Moves every edition of `id` into `targetId` and deletes `id`. */
export async function mergeEvents(db: Db, id: number, targetId: number): Promise<MergeResult> {
  if (id === targetId) return { ok: false, reason: 'same_event' };
  const rows = await db
    .select({ id: events.id, sport: events.sport })
    .from(events)
    .where(inArray(events.id, [id, targetId]));
  if (rows.length !== 2) return { ok: false, reason: 'not_found' };
  if (rows[0]!.sport !== rows[1]!.sport) return { ok: false, reason: 'other_sport' };
  await db.transaction(async (tx) => {
    await tx
      .update(activities)
      .set({ eventId: targetId, updatedAt: new Date() })
      .where(eq(activities.eventId, id));
    await tx.delete(events).where(eq(events.id, id));
  });
  return { ok: true };
}

/**
 * Saves the manual order of a sport's events: `ids` first, in the given order; events left
 * out (e.g. created meanwhile in another window) follow in their previous order.
 */
export async function saveEventOrder(
  db: Db,
  sport: Sport,
  ids: readonly number[],
): Promise<boolean> {
  const rows = await db
    .select({ id: events.id, sortOrder: events.sortOrder })
    .from(events)
    .where(eq(events.sport, sport));
  const known = new Set(rows.map((r) => r.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) return false;

  const listed = new Set(ids);
  const rest = rows
    .filter((r) => !listed.has(r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((r) => r.id);
  const order = [...ids, ...rest];
  const current = new Map(rows.map((r) => [r.id, r.sortOrder]));
  await db.transaction(async (tx) => {
    for (const [index, id] of order.entries()) {
      if (current.get(id) !== index) {
        await tx.update(events).set({ sortOrder: index }).where(eq(events.id, id));
      }
    }
  });
  return true;
}

/** Events of a sport with a name similar to `name` (PLAN.md 4.3). */
export async function suggestEventsFor(
  db: Db,
  sport: Sport,
  name: string,
): Promise<EventSuggestion[]> {
  const rows = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(eq(events.sport, sport));
  return suggestEvents(name, rows);
}
