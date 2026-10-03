import type { ActivityDetail, ActivityListItem, Effort } from '@rekordy/core';
import type { Db } from '../db/client';
import { activities, efforts } from '../db/schema';

/** Drizzle transaction handle; services accept either the database or a transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Executor = Db | Tx;

export type ActivityRow = typeof activities.$inferSelect;
export type NewActivityRow = typeof activities.$inferInsert;
export type EffortRow = typeof efforts.$inferSelect;

/** Columns needed for list items (no notes, splits, …). */
export const listColumns = {
  id: activities.id,
  sport: activities.sport,
  name: activities.name,
  localDate: activities.localDate,
  startTimeUtc: activities.startTimeUtc,
  distanceM: activities.distanceM,
  durationS: activities.durationS,
  isRace: activities.isRace,
  isHidden: activities.isHidden,
  source: activities.source,
  activityUrl: activities.activityUrl,
};
export type ListRow = Pick<ActivityRow, keyof typeof listColumns>;

/** ISO timestamp → MySQL DATETIME text (UTC, whole seconds). */
export function toSqlDateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ');
}

/** MySQL DATETIME text (UTC) → ISO timestamp. */
export function fromSqlDateTime(value: string): string {
  return new Date(`${value.replace(' ', 'T')}Z`).toISOString();
}

export function toListItem(row: ListRow): ActivityListItem {
  return {
    id: row.id,
    sport: row.sport,
    name: row.name,
    localDate: row.localDate,
    startTimeUtc: row.startTimeUtc ? fromSqlDateTime(row.startTimeUtc) : null,
    distanceM: row.distanceM,
    durationS: row.durationS,
    paceSPerKm:
      row.durationS !== null && row.distanceM > 0
        ? Math.round((row.durationS / row.distanceM) * 1_000_000) / 1000
        : null,
    isRace: row.isRace,
    isHidden: row.isHidden,
    source: row.source,
    activityUrl: row.activityUrl,
  };
}

export function toEffort(row: EffortRow): Effort {
  return {
    id: row.id,
    activityId: row.activityId,
    sport: row.sport,
    distanceKey: row.distanceKey as Effort['distanceKey'],
    targetM: row.targetM,
    actualDistanceM: row.actualDistanceM,
    durationS: row.durationS,
    paceSPerKm: row.paceSPerKm,
    isTolerance: row.isTolerance,
    origin: row.origin,
    isEdited: row.isEdited,
    isDeleted: row.isDeleted,
  };
}

export function toDetail(
  row: ActivityRow,
  effortRows: EffortRow[],
  eventName: string | null,
): ActivityDetail {
  return {
    ...toListItem(row),
    elapsedS: row.elapsedS,
    elevationGainM: row.elevationGainM,
    eventId: row.eventId,
    eventName,
    editionLabel: row.editionLabel,
    notes: row.notes,
    externalId: row.externalId,
    fileName: row.fileName,
    splits: row.splits,
    hasStream: row.hasStream,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    efforts: effortRows.map(toEffort),
  };
}
