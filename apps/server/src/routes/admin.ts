import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { getJob, latestJob, runJobChunk, startRecomputeAll } from '../jobs/service';
import { recordMessages } from '../records/messages';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const editorOnly = { access: 'editor' } as const;

/**
 * `/api/admin/*` (editor): recompute all efforts as a chunked, resumable job. The page starts
 * (or resumes) the job, then calls `run` until it is done; each call is one short chunk.
 */
export const adminRoutes =
  (db: Db): FastifyPluginAsync =>
  async (base) => {
    const app = base.withTypeProvider<ZodTypeProvider>();

    app.get('/admin/recompute-all', { config: editorOnly }, async () => ({
      job: await latestJob(db, 'recompute_all'),
    }));

    app.post('/admin/recompute-all', async (_request, reply) => {
      const { job, created } = await startRecomputeAll(db);
      return reply.code(created ? 201 : 200).send(job);
    });

    app.get(
      '/admin/jobs/:id',
      { config: editorOnly, schema: { params: idParams } },
      async (request, reply) => {
        const job = await getJob(db, request.params.id);
        if (!job) return reply.code(404).send({ error: recordMessages.jobNotFound });
        return job;
      },
    );

    app.post('/admin/jobs/:id/run', { schema: { params: idParams } }, async (request, reply) => {
      const job = await runJobChunk(db, request.params.id);
      if (!job) return reply.code(404).send({ error: recordMessages.jobNotFound });
      return job;
    });
  };
