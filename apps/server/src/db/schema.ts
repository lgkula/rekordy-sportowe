import { json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

/** Key/value application settings (e.g. `events.ordering.road_run`). */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().onUpdateNow(),
});
