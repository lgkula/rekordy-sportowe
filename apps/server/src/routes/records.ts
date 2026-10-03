import { deletedEffortsQuerySchema, effortPatchSchema, recordsQuerySchema } from '@rekordy/core';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { recordMessages } from '../records/messages';
import {
  deleteEffort,
  getRecords,
  listDeletedEfforts,
  patchEffort,
  resetEffort,
  restoreEffort,
  type EffortChangeResult,
} from '../records/service';

const idParams = z.object({ id: z.coerce.number().int().positive() });

function sendChange(reply: FastifyReply, result: EffortChangeResult) {
  if (result.ok) return reply.send(result.effort);
  switch (result.reason) {
    case 'not_found':
      return reply.code(404).send({ error: recordMessages.effortNotFound });
    case 'not_computed':
      return reply.code(409).send({ error: recordMessages.notComputed });
    case 'invalid':
      return reply.code(400).send({ error: recordMessages.invalid, issues: result.issues });
  }
}

/**
 * `/api/records` and `/api/efforts` (PLAN.md 7). Reads need a session, changes the editor
 * role (default guards); the deleted list is editor-only too.
 */
export const recordRoutes =
  (db: Db): FastifyPluginAsync =>
  async (base) => {
    const app = base.withTypeProvider<ZodTypeProvider>();

    app.get('/records', { schema: { querystring: recordsQuerySchema } }, (request) =>
      getRecords(db, request.query.sport),
    );

    app.get(
      '/efforts/deleted',
      { config: { access: 'editor' }, schema: { querystring: deletedEffortsQuerySchema } },
      (request) => listDeletedEfforts(db, request.query.sport),
    );

    app.patch(
      '/efforts/:id',
      { schema: { params: idParams, body: effortPatchSchema } },
      async (request, reply) =>
        sendChange(reply, await patchEffort(db, request.params.id, request.body)),
    );

    app.delete('/efforts/:id', { schema: { params: idParams } }, async (request, reply) => {
      const deleted = await deleteEffort(db, request.params.id);
      if (!deleted) return reply.code(404).send({ error: recordMessages.effortNotFound });
      return reply.code(204).send();
    });

    app.post('/efforts/:id/restore', { schema: { params: idParams } }, async (request, reply) =>
      sendChange(reply, await restoreEffort(db, request.params.id)),
    );

    app.post('/efforts/:id/reset', { schema: { params: idParams } }, async (request, reply) =>
      sendChange(reply, await resetEffort(db, request.params.id)),
    );
  };
