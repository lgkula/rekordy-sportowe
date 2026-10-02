import type { FastifyPluginAsync } from 'fastify';
import type { MigrationStatus } from '../db/migrations';
import { appVersion } from '../version';

export type HealthDeps = {
  checkDb: () => Promise<void>;
  migrationStatus: () => Promise<MigrationStatus>;
  checkStorage: () => Promise<boolean>;
};

export type HealthResponse = {
  status: 'ok' | 'degraded';
  version: string;
  node: string;
  uptimeS: number;
  db: { ok: boolean; error?: string };
  migrations: { ok: boolean; applied?: number; pending?: string[]; error?: string };
  storage: { writable: boolean };
  auth: { configured: boolean };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `GET /api/health` (public): 200 when everything is fine, 503 otherwise (used by the deploy
 * script). Missing auth secrets also count as unhealthy, since nobody could log in.
 */
export const healthRoutes =
  (deps: HealthDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/health', { config: { access: 'public' } }, async (_request, reply) => {
      const body: HealthResponse = {
        status: 'ok',
        version: appVersion,
        node: process.version,
        uptimeS: Math.round(process.uptime()),
        db: { ok: true },
        migrations: { ok: true },
        storage: { writable: await deps.checkStorage() },
        auth: { configured: app.auth.configured },
      };

      try {
        await deps.checkDb();
      } catch (error) {
        body.db = { ok: false, error: errorMessage(error) };
      }

      if (body.db.ok) {
        try {
          const status = await deps.migrationStatus();
          body.migrations = {
            ok: status.pending.length === 0,
            applied: status.applied,
            pending: status.pending,
          };
        } catch (error) {
          body.migrations = { ok: false, error: errorMessage(error) };
        }
      } else {
        body.migrations = { ok: false, error: 'Database unavailable' };
      }

      const healthy =
        body.db.ok && body.migrations.ok && body.storage.writable && body.auth.configured;
      body.status = healthy ? 'ok' : 'degraded';
      return reply
        .code(healthy ? 200 : 503)
        .header('cache-control', 'no-store')
        .send(body);
    });
  };
