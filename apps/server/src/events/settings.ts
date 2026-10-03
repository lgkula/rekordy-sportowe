import {
  DEFAULT_EVENT_ORDERING,
  EVENT_ORDERINGS,
  eventOrderingKey,
  settingDefault,
  type EventOrdering,
  type Sport,
} from '@rekordy/core';
import { eq } from 'drizzle-orm';
import type { Executor } from '../activities/rows';
import { settings } from '../db/schema';

/** Stored value of a setting, or its default when it was never saved. */
export async function getSetting(db: Executor, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));
  return row ? row.value : settingDefault(key);
}

/** Saves a setting (the caller validates the value). */
export async function putSetting(db: Executor, key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

export async function getEventOrdering(db: Executor, sport: Sport): Promise<EventOrdering> {
  const value = await getSetting(db, eventOrderingKey(sport));
  return EVENT_ORDERINGS.includes(value as EventOrdering)
    ? (value as EventOrdering)
    : DEFAULT_EVENT_ORDERING;
}
