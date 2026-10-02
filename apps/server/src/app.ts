import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthRoutes, type HealthDeps } from './routes/health';

export type BuildAppOptions = {
  webDir: string;
  health: HealthDeps;
  logger?: FastifyServerOptions['logger'];
};

/** Builds the Fastify instance without starting it (also used by tests via `inject`). */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(
    async (api) => {
      await api.register(healthRoutes(options.health));
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
