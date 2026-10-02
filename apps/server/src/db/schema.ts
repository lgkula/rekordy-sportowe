import { bigint, int, json, mysqlTable, timestamp, varchar } from 'drizzle-orm/mysql-core';

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
