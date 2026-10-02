import { sql } from 'drizzle-orm';
import { buildApp } from './app';
import { createDbLimiter } from './auth/limiter';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { getMigrationStatus } from './db/migrations';
import { checkStorageWritable } from './storage';
import { appVersion } from './version';

/**
 * Production entry point. Started by the hosting's Node.js selector through `app.js` (never by
 * hand on the host). On Seohost the runner is LiteSpeed `lsnode.js` (Passenger-compatible): it
 * overrides `listen()` with its own socket, so the port below only matters locally.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const database = createDatabase(config);
  const migrationQuery = async (query: string) =>
    (await database.pool.query(query))[0] as unknown[];

  const app = await buildApp({
    webDir: config.webDir,
    // LiteSpeed (lsnode) keeps only stderr, in <app-root>/stderr.log; stdout is discarded.
    logger: { level: config.logLevel, stream: process.stderr },
    health: {
      checkDb: async () => {
        await database.db.execute(sql`SELECT 1`);
      },
      migrationStatus: () => getMigrationStatus(migrationQuery, config.migrationsDir),
      checkStorage: () => checkStorageWritable(config.storageDir),
    },
    auth: { config: config.auth, limiter: createDbLimiter(database.pool) },
    db: database.db,
  });

  app.addHook('onClose', async () => {
    await database.close();
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down');
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ version: appVersion, node: process.version, cwd: process.cwd() }, 'Started');
  if (!app.auth.configured) {
    app.log.error('Auth is not configured: run `node dist/tools.cjs hash-secret --write`');
  }

  // Migrations are applied by the deploy script over SSH, never by Passenger workers.
  // Here we only warn, and /api/health reports the same state.
  try {
    const status = await getMigrationStatus(migrationQuery, config.migrationsDir);
    if (status.pending.length > 0) {
      app.log.error(
        { pending: status.pending },
        'Pending database migrations: run `node dist/tools.cjs migrate`',
      );
    }
  } catch (error) {
    app.log.error({ err: error }, 'Could not check migration status');
  }
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
