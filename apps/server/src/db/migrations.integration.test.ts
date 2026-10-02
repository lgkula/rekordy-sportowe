import path from 'node:path';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile, parseConfig, type Config } from '../config';
import { connectionOptions } from './client';
import { getMigrationStatus, runMigrations } from './migrations';

// Uses the database named by TEST_DB_NAME (from the environment or apps/server/.env).
// The database is wiped before the tests. Skipped when TEST_DB_NAME is not set.
const serverDir = path.resolve(import.meta.dirname, '../..');
const env: NodeJS.ProcessEnv = { ENV_FILE: path.join(serverDir, '.env'), ...process.env };
loadEnvFile(env);
const testDbName = env.TEST_DB_NAME;

describe.skipIf(!testDbName)('migrations against a real database', () => {
  let config: Config;
  let connection: mysql.Connection;
  const query = async (sql: string) => (await connection.query(sql))[0] as unknown[];

  beforeAll(async () => {
    config = parseConfig({
      ...env,
      DB_NAME: testDbName,
      MIGRATIONS_DIR: path.join(serverDir, 'drizzle'),
    });
    connection = await mysql.createConnection(connectionOptions(config));
    const [tables] = await connection.query('SHOW TABLES');
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const row of tables as Array<Record<string, string>>) {
      const table = Object.values(row)[0];
      await connection.query(`DROP TABLE \`${table}\``);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  afterAll(async () => {
    await connection?.end();
  });

  it('reports all migrations as pending on an empty database', async () => {
    const status = await getMigrationStatus(query, config.migrationsDir);
    expect(status.applied).toBe(0);
    expect(status.pending.length).toBe(status.total);
  });

  it('applies migrations, also when two runs start at the same time', async () => {
    const [first, second] = await Promise.all([runMigrations(config), runMigrations(config)]);
    expect(first.pending).toEqual([]);
    expect(second.pending).toEqual([]);
    const [rows] = await connection.query("SHOW TABLES LIKE 'settings'");
    expect(rows).toHaveLength(1);
  });

  it('is idempotent', async () => {
    const status = await runMigrations(config);
    expect(status.pending).toEqual([]);
    expect(status.applied).toBe(status.total);
  });
});
