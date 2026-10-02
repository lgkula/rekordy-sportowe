import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql from 'mysql2/promise';
import type { Config } from '../config';
import { connectionOptions } from './client';

/** Table maintained by the Drizzle migrator. */
const MIGRATIONS_TABLE = '__drizzle_migrations';
const LOCK_NAME = 'rekordy_sportowe_migrate';
const LOCK_TIMEOUT_S = 30;

type JournalEntry = { idx: number; when: number; tag: string };

export type MigrationStatus = {
  total: number;
  applied: number;
  pending: string[];
};

async function readJournal(migrationsDir: string): Promise<JournalEntry[]> {
  const raw = await readFile(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(raw) as { entries: JournalEntry[] };
  return journal.entries;
}

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string }).code === 'ER_NO_SUCH_TABLE';
}

/**
 * Compares the migration journal with the database. Mirrors the Drizzle migrator rule:
 * a migration is pending when its timestamp is newer than the last applied one.
 */
export async function getMigrationStatus(
  query: (sql: string) => Promise<unknown[]>,
  migrationsDir: string,
): Promise<MigrationStatus> {
  const entries = await readJournal(migrationsDir);
  let lastApplied = 0;
  try {
    const rows = (await query(
      `SELECT MAX(created_at) AS last FROM \`${MIGRATIONS_TABLE}\``,
    )) as Array<{ last: number | string | null }>;
    lastApplied = Number(rows[0]?.last ?? 0);
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const pending = entries.filter((e) => e.when > lastApplied).map((e) => e.tag);
  return { total: entries.length, applied: entries.length - pending.length, pending };
}

/**
 * Applies pending migrations on a dedicated connection, guarded by a MySQL named lock
 * so that two concurrent runs cannot interleave.
 */
export async function runMigrations(config: Config): Promise<MigrationStatus> {
  const connection = await mysql.createConnection({
    ...connectionOptions(config),
    multipleStatements: true,
  });
  const query = async (sql: string) => (await connection.query(sql))[0] as unknown[];
  try {
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, ?) AS locked', [
      LOCK_NAME,
      LOCK_TIMEOUT_S,
    ]);
    if ((lockRows as Array<{ locked: number }>)[0]?.locked !== 1) {
      throw new Error(`Could not acquire migration lock within ${LOCK_TIMEOUT_S}s`);
    }
    try {
      await migrate(drizzle(connection), { migrationsFolder: config.migrationsDir });
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
    return await getMigrationStatus(query, config.migrationsDir);
  } finally {
    await connection.end();
  }
}
