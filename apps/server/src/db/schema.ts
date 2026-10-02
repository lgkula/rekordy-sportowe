import { ACTIVITY_SOURCES, SPORTS, type Split } from '@rekordy/core';
import {
  bigint,
  boolean,
  char,
  customType,
  date,
  datetime,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type AnyMySqlColumn,
} from 'drizzle-orm/mysql-core';

/**
 * JSON column that also works on MariaDB, where JSON is an alias of LONGTEXT and the driver
 * returns the raw string (Drizzle's `json` only parses MySQL's native JSON type).
 */
const jsonText = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => 'json',
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => (typeof value === 'string' ? (JSON.parse(value) as T) : (value as T)),
  })(name);

const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'mediumblob',
});

/** DECIMAL read as a JS number (mysql2 returns DECIMAL as a string by default). */
const metres = (name: string) => decimal(name, { precision: 9, scale: 1, mode: 'number' });
const seconds = metres;

/** Key/value application settings (e.g. `events.ordering.road_run`). */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});

/** Failed login / role switch / agent token attempts per key (e.g. `ip:1.2.3.4`). */
export const authFailures = mysqlTable('auth_failures', {
  key: varchar('key', { length: 100 }).primaryKey(),
  failures: int('failures').notNull(),
  resetAtMs: bigint('reset_at_ms', { mode: 'number' }).notNull(),
});

/** A race grouping its editions (e.g. "Bieg Niepodległości"), PLAN.md 4.3. */
export const events = mysqlTable(
  'events',
  {
    id: int('id').autoincrement().primaryKey(),
    sport: mysqlEnum('sport', SPORTS).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    displayDistanceM: metres('display_distance_m'),
    sortOrder: int('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('events_sport_order_idx').on(t.sport, t.sortOrder)],
);

export const activities = mysqlTable(
  'activities',
  {
    id: int('id').autoincrement().primaryKey(),
    sport: mysqlEnum('sport', SPORTS).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    /** Null when only the date is known (manual entry without a start time). */
    startTimeUtc: datetime('start_time_utc', { mode: 'string' }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    distanceM: metres('distance_m').notNull(),
    /** Timer time, auto-pause excluded (PLAN.md Q2). Null for a simplified entry without it. */
    durationS: seconds('duration_s'),
    elapsedS: seconds('elapsed_s'),
    elevationGainM: int('elevation_gain_m'),
    isRace: boolean('is_race').notNull().default(false),
    isHidden: boolean('is_hidden').notNull().default(false),
    eventId: int('event_id').references((): AnyMySqlColumn => events.id, {
      onDelete: 'set null',
    }),
    editionLabel: varchar('edition_label', { length: 100 }),
    notes: text('notes'),
    activityUrl: varchar('activity_url', { length: 500 }),
    source: mysqlEnum('source', ACTIVITY_SOURCES).notNull(),
    externalId: varchar('external_id', { length: 100 }),
    fileName: varchar('file_name', { length: 255 }),
    fileSha256: char('file_sha256', { length: 64 }),
    splits: jsonText<Split[]>('splits'),
    hasStream: boolean('has_stream').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    uniqueIndex('activities_external_id_uq').on(t.externalId),
    uniqueIndex('activities_file_name_uq').on(t.fileName),
    uniqueIndex('activities_file_sha256_uq').on(t.fileSha256),
    // Default list order (newest first), per sport and across sports.
    index('activities_sport_date_idx').on(t.sport, t.localDate, t.startTimeUtc),
    index('activities_date_idx').on(t.localDate, t.startTimeUtc),
    // Fuzzy duplicate lookup (start ±2 min).
    index('activities_start_idx').on(t.startTimeUtc),
  ],
);

/** Recorded samples at ~1 Hz: gzip of JSON `{t, d, alt}` (PLAN.md 5). */
export const activityStreams = mysqlTable('activity_streams', {
  activityId: int('activity_id')
    .primaryKey()
    .references(() => activities.id, { onDelete: 'cascade' }),
  data: mediumBlob('data').notNull(),
});

/** Materialised best efforts: one result per activity and record distance (PLAN.md 4.2). */
export const efforts = mysqlTable(
  'efforts',
  {
    id: int('id').autoincrement().primaryKey(),
    activityId: int('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    /** Copy of the activity's sport, for the records query. */
    sport: mysqlEnum('sport', SPORTS).notNull(),
    distanceKey: varchar('distance_key', { length: 10 }).notNull(),
    targetM: metres('target_m').notNull(),
    actualDistanceM: metres('actual_distance_m').notNull(),
    durationS: seconds('duration_s').notNull(),
    paceSPerKm: decimal('pace_s_per_km', { precision: 9, scale: 3, mode: 'number' }).notNull(),
    isTolerance: boolean('is_tolerance').notNull(),
    origin: mysqlEnum('origin', ['computed', 'manual']).notNull(),
    /** Changed by hand: recomputation must not overwrite it. */
    isEdited: boolean('is_edited').notNull().default(false),
    /** Soft delete, so that recomputation does not bring the result back. */
    isDeleted: boolean('is_deleted').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
  },
  (t) => [
    uniqueIndex('efforts_activity_distance_uq').on(t.activityId, t.distanceKey),
    // Records: top results per sport and distance, ranked by pace.
    index('efforts_records_idx').on(t.sport, t.distanceKey, t.isDeleted, t.paceSPerKm),
  ],
);

export const IMPORT_SOURCES = ['fit', 'strava_export', 'garmin_export', 'agent'] as const;

export const importBatches = mysqlTable('import_batches', {
  id: int('id').autoincrement().primaryKey(),
  source: mysqlEnum('source', IMPORT_SOURCES).notNull(),
  autoApprove: boolean('auto_approve').notNull().default(false),
  summary: jsonText<Record<string, unknown>>('summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Review queue for FIT, bulk and agent imports (PLAN.md 6). */
export const importItems = mysqlTable(
  'import_items',
  {
    id: int('id').autoincrement().primaryKey(),
    batchId: int('batch_id').references(() => importBatches.id, { onDelete: 'cascade' }),
    source: mysqlEnum('source', IMPORT_SOURCES).notNull(),
    fileName: varchar('file_name', { length: 255 }),
    fileSha256: char('file_sha256', { length: 64 }),
    externalId: varchar('external_id', { length: 100 }),
    status: mysqlEnum('status', ['pending', 'approved', 'rejected', 'duplicate', 'error'])
      .notNull()
      .default('pending'),
    /** Normalised activity preview. */
    parsed: jsonText<Record<string, unknown>>('parsed'),
    duplicateOfActivityId: int('duplicate_of_activity_id').references(() => activities.id, {
      onDelete: 'set null',
    }),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('import_items_status_idx').on(t.status, t.createdAt),
    index('import_items_sha256_idx').on(t.fileSha256),
    index('import_items_external_id_idx').on(t.externalId),
  ],
);
