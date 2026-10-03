import { activityCreateSchema, activityListQuerySchema, activityPatchSchema } from '@rekordy/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityMessages } from '../activities/messages';
import {
  createActivity,
  deleteActivity,
  fromCreateInput,
  getActivityDetail,
  listActivities,
  patchActivity,
} from '../activities/service';
import type { Db } from '../db/client';

const idParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * `/api/activities` (PLAN.md 7). Access follows the default guards: reads need a session,
 * mutations the editor role.
 */
export const activityRoutes =
  (db: Db): FastifyPluginAsync =>
  async (base) => {
    const app = base.withTypeProvider<ZodTypeProvider>();

    app.get('/activities', { schema: { querystring: activityListQuerySchema } }, (request) =>
      listActivities(db, request.query),
    );

    app.get('/activities/:id', { schema: { params: idParams } }, async (request, reply) => {
      const activity = await getActivityDetail(db, request.params.id);
      if (!activity) return reply.code(404).send({ error: activityMessages.notFound });
      return activity;
    });

    app.post('/activities', { schema: { body: activityCreateSchema } }, async (request, reply) => {
      const { row, manualEffort, newEventName } = fromCreateInput(request.body);
      const result = await createActivity(db, row, {
        manualEffort,
        newEventName,
        confirmDuplicate: request.body.confirmDuplicate,
      });
      if (!result.ok) {
        return 'conflict' in result
          ? reply.code(409).send(result.conflict)
          : reply.code(400).send({ error: activityMessages.invalid, issues: result.issues });
      }
      return reply.code(201).send(await getActivityDetail(db, result.id));
    });

    app.patch(
      '/activities/:id',
      { schema: { params: idParams, body: activityPatchSchema } },
      async (request, reply) => {
        const result = await patchActivity(db, request.params.id, request.body);
        if (!result.ok) {
          return result.reason === 'not_found'
            ? reply.code(404).send({ error: activityMessages.notFound })
            : reply.code(400).send({ error: activityMessages.invalid, issues: result.issues });
        }
        return getActivityDetail(db, request.params.id);
      },
    );

    app.delete('/activities/:id', { schema: { params: idParams } }, async (request, reply) => {
      const deleted = await deleteActivity(db, request.params.id);
      if (!deleted) return reply.code(404).send({ error: activityMessages.notFound });
      return reply.code(204).send();
    });
  };
