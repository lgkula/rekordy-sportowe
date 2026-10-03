import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import type { Config } from '../config';
import * as schema from './schema';

export type Db = MySql2Database<typeof schema>;

export type Database = {
  db: Db;
  pool: mysql.Pool;
  close: () => Promise<void>;
};

export function connectionOptions(config: Config): mysql.ConnectionOptions {
  return {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    timezone: 'Z',
    // MariaDB ≥ 10.5 marks JSON columns in its metadata and mysql2 would parse them, while
    // 10.4 sends plain text. Raw strings everywhere; the schema's `jsonText` parses them
    // (otherwise a JSON string value such as "name" would be parsed twice).
    jsonStrings: true,
    charset: 'utf8mb4_unicode_ci',
    connectTimeout: 5000,
  };
}

/** Creates a lazy connection pool; no connection is opened until the first query. */
export function createDatabase(config: Config): Database {
  const pool = mysql.createPool({
    ...connectionOptions(config),
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 60_000,
    enableKeepAlive: true,
  });
  // TIMESTAMP columns are converted through the session time zone. The driver reads and
  // writes them as UTC (`timezone: 'Z'`), so the session must be UTC as well; otherwise
  // `DEFAULT now()` values read back shifted and dates written from JS are stored shifted
  // (the server's system zone is Europe/Warsaw locally and unknown on the host).
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool, close: () => pool.end() };
}
