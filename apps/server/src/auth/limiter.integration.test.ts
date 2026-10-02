import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnvFile, parseConfig } from '../config';
import { createDatabase, type Database } from '../db/client';
import { runMigrations } from '../db/migrations';
import { createDbLimiter, MAX_FAILURES, WINDOW_MS } from './limiter';

// Uses the database named by TEST_DB_NAME (see migrations.integration.test.ts).
const serverDir = path.resolve(import.meta.dirname, '../..');
const env: NodeJS.ProcessEnv = { ENV_FILE: path.join(serverDir, '.env'), ...process.env };
loadEnvFile(env);
const testDbName = env.TEST_DB_NAME;

describe.skipIf(!testDbName)('database limiter', () => {
  let database: Database;

  beforeAll(async () => {
    const config = parseConfig({
      ...env,
      DB_NAME: testDbName,
      MIGRATIONS_DIR: path.join(serverDir, 'drizzle'),
    });
    await runMigrations(config);
    database = createDatabase(config);
    await database.pool.query('DELETE FROM auth_failures');
  });

  afterAll(async () => {
    await database?.close();
  });

  it('blocks after MAX_FAILURES failures, shares state between instances, then resets', async () => {
    let now = 1_000_000;
    const clock = () => now;
    const first = createDbLimiter(database.pool, clock);
    // A second instance stands for another Passenger process.
    const second = createDbLimiter(database.pool, clock);

    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await (i % 2 ? first : second).recordFailure('ip:10.0.0.1');
    }
    expect(await first.retryAfterS('ip:10.0.0.1')).toBe(0);

    await first.recordFailure('ip:10.0.0.1');
    expect(await second.retryAfterS('ip:10.0.0.1')).toBe(WINDOW_MS / 1000);
    expect(await second.retryAfterS('ip:10.0.0.2')).toBe(0);

    now += WINDOW_MS;
    expect(await first.retryAfterS('ip:10.0.0.1')).toBe(0);

    // The next failure starts a new window (and cleans up expired rows).
    await first.recordFailure('ip:10.0.0.1');
    const [rows] = await database.pool.query(
      'SELECT failures, reset_at_ms AS resetAtMs FROM auth_failures',
    );
    expect(
      (rows as Array<{ failures: number; resetAtMs: string | number }>).map((row) => ({
        failures: row.failures,
        resetAtMs: Number(row.resetAtMs),
      })),
    ).toEqual([{ failures: 1, resetAtMs: now + WINDOW_MS }]);
  });
});
