import path from 'node:path';
import { loadEnvFile, parseConfig } from '../config';
import { createDatabase, type Database } from '../db/client';
import { runMigrations } from '../db/migrations';

/**
 * Integration tests use the database named by TEST_DB_NAME (from the environment or
 * apps/server/.env) and are skipped when it is not set. Test files run one at a time
 * (see vitest.config.ts), since they share that database.
 */
const serverDir = path.resolve(import.meta.dirname, '../..');
const env: NodeJS.ProcessEnv = { ENV_FILE: path.join(serverDir, '.env'), ...process.env };
loadEnvFile(env);

export const testDbName = env.TEST_DB_NAME;

/** Migrates the test database and connects to it. */
export async function openTestDatabase(): Promise<Database> {
  const config = parseConfig({
    ...env,
    DB_NAME: testDbName,
    MIGRATIONS_DIR: path.join(serverDir, 'drizzle'),
  });
  await runMigrations(config);
  return createDatabase(config);
}

/** Removes all activities and everything that hangs off them. */
export async function clearActivityData(database: Database): Promise<void> {
  for (const table of [
    'import_items',
    'import_batches',
    'efforts',
    'activity_streams',
    'activities',
    'events',
  ]) {
    await database.pool.query(`DELETE FROM \`${table}\``);
  }
}
