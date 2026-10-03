import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authPlugin, type AuthOptions } from './auth/plugin';
import type { Db } from './db/client';
import { activityRoutes } from './routes/activities';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { eventRoutes } from './routes/events';
import { importRoutes } from './routes/imports';
import { recordRoutes } from './routes/records';
import { healthRoutes, type HealthDeps } from './routes/health';

export type BuildAppOptions = {
  webDir: string;
  health: HealthDeps;
  auth: AuthOptions;
  /** Routes that need the database are registered only with it (tests may omit it). */
  db?: Db;
  /** Root of stored files (original FIT files); the import routes need it. */
  storageDir?: string;
  logger?: FastifyServerOptions['logger'];
};

/** Builds the Fastify instance without starting it (also used by tests via `inject`). */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Trust only the immediate peer (the host's LiteSpeed): request.ip is the last
    // X-Forwarded-For entry, the one LiteSpeed added, so a client cannot dodge the login
    // rate limit with a forged header.
    trustProxy: (_address, hop) => hop === 0,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(authPlugin, options.auth);

  await app.register(
    async (api) => {
      await api.register(healthRoutes(options.health));
      await api.register(authRoutes);
      if (options.db) {
        await api.register(activityRoutes(options.db));
        await api.register(recordRoutes(options.db));
        await api.register(adminRoutes(options.db));
        await api.register(eventRoutes(options.db));
      }
      if (options.db && options.storageDir) {
        await api.register(importRoutes(options.db, options.storageDir));
      }
    },
    { prefix: '/api' },
  );

  const indexHtml = path.join(options.webDir, 'index.html');
  const hasWeb = existsSync(indexHtml);
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // Vite emits content-hashed files under /assets, safe to cache forever.
        const hashedAsset = filePath.split(/[\\/]/).includes('assets');
        reply.header(
          'cache-control',
          hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === '/api' || request.url.startsWith('/api/');
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (!isApi && hasWeb && isRead) {
      // SPA history fallback: client-side routes are resolved by React Router.
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Nie znaleziono' });
  });

  return app;
}
