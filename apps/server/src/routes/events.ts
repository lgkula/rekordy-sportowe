import {
  eventCreateSchema,
  eventListQuerySchema,
  eventMergeSchema,
  eventOrderSchema,
  eventPatchSchema,
  eventSuggestQuerySchema,
  settingValueSchema,
  type SettingResponse,
} from '@rekordy/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client';
import { eventMessages } from '../events/messages';
import {
  createEvent,
  deleteEvent,
  getEvent,
  listEvents,
  mergeEvents,
  patchEvent,
  saveEventOrder,
  suggestEventsFor,
} from '../events/service';
import { getSetting, putSetting } from '../events/settings';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const keyParams = z.object({ key: z.string().min(1).max(100) });

/**
 * `/api/events` and `/api/settings` (PLAN.md 7). Reads need a session, changes the editor
 * role (default guards).
 */
export const eventRoutes =
  (db: Db): FastifyPluginAsync =>
  async (base) => {
    const app = base.withTypeProvider<ZodTypeProvider>();

    app.get('/events', { schema: { querystring: eventListQuerySchema } }, (request) =>
      listEvents(db, request.query.sport),
    );

    app.get('/events/suggest', { schema: { querystring: eventSuggestQuerySchema } }, (request) =>
      suggestEventsFor(db, request.query.sport, request.query.name),
    );

    app.get('/events/:id', { schema: { params: idParams } }, async (request, reply) => {
      const event = await getEvent(db, request.params.id);
      if (!event) return reply.code(404).send({ error: eventMessages.notFound });
      return event;
    });

    app.post('/events', { schema: { body: eventCreateSchema } }, async (request, reply) => {
      const result = await createEvent(db, request.body);
      if (!result.ok) {
        return reply.code(400).send({ error: eventMessages.invalid, issues: result.issues });
      }
      return reply.code(201).send(await getEvent(db, result.id));
    });

    app.put('/events/order', { schema: { body: eventOrderSchema } }, async (request, reply) => {
      const saved = await saveEventOrder(db, request.body.sport, request.body.ids);
      if (!saved) return reply.code(400).send({ error: eventMessages.orderInvalid });
      return reply.code(204).send();
    });

    app.patch(
      '/events/:id',
      { schema: { params: idParams, body: eventPatchSchema } },
      async (request, reply) => {
        const found = await patchEvent(db, request.params.id, request.body);
        if (!found) return reply.code(404).send({ error: eventMessages.notFound });
        return getEvent(db, request.params.id);
      },
    );

    app.delete('/events/:id', { schema: { params: idParams } }, async (request, reply) => {
      const deleted = await deleteEvent(db, request.params.id);
      if (!deleted) return reply.code(404).send({ error: eventMessages.notFound });
      return reply.code(204).send();
    });

    app.post(
      '/events/:id/merge',
      { schema: { params: idParams, body: eventMergeSchema } },
      async (request, reply) => {
        const { targetId } = request.body;
        const result = await mergeEvents(db, request.params.id, targetId);
        if (!result.ok) {
          switch (result.reason) {
            case 'not_found':
              return reply.code(404).send({ error: eventMessages.notFound });
            case 'same_event':
              return reply.code(400).send({ error: eventMessages.mergeSelf });
            case 'other_sport':
              return reply.code(400).send({ error: eventMessages.mergeSport });
          }
        }
        return getEvent(db, targetId);
      },
    );

    app.get('/settings/:key', { schema: { params: keyParams } }, async (request, reply) => {
      const { key } = request.params;
      if (!settingValueSchema(key)) {
        return reply.code(404).send({ error: eventMessages.unknownSetting });
      }
      return { key, value: await getSetting(db, key) } satisfies SettingResponse;
    });

    app.put(
      '/settings/:key',
      { schema: { params: keyParams, body: z.object({ value: z.unknown() }) } },
      async (request, reply) => {
        const { key } = request.params;
        const schema = settingValueSchema(key);
        if (!schema) return reply.code(404).send({ error: eventMessages.unknownSetting });
        const value = schema.safeParse(request.body.value);
        if (!value.success) {
          return reply.code(400).send({ error: eventMessages.invalidSetting });
        }
        await putSetting(db, key, value.data);
        return { key, value: value.data } satisfies SettingResponse;
      },
    );
  };
