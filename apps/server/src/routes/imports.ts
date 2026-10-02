import multipart from '@fastify/multipart';
import { FIT_MAX_FILE_BYTES, fitImportMetaSchema, importCheckRequestSchema } from '@rekordy/core';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { activityMessages } from '../activities/messages';
import { getActivityDetail } from '../activities/service';
import type { Db } from '../db/client';
import { fitErrorMessages, importMessages } from '../imports/messages';
import { checkImportItems, importFitFile } from '../imports/service';

/** Browsers send the bare name; strip any path a client might add. */
function cleanFileName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '').trim().slice(0, 255) || 'activity.fit';
}

/** Multipart errors of @fastify/multipart / busboy (limits exceeded, malformed body). */
function multipartErrorStatus(error: unknown): number | null {
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('FST_')) return null;
  return code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400;
}

/**
 * `/api/import/*` (PLAN.md 7), editor only (the default guard for non-GET routes):
 * - `POST /import/check`: duplicate check of a batch before the review;
 * - `POST /import/fit`: multipart with one approved `file` and its `meta` (JSON with the
 *   user's choices from the review), sent one file per request.
 */
export const importRoutes =
  (db: Db, storageDir: string): FastifyPluginAsync =>
  async (base) => {
    const app = base.withTypeProvider<ZodTypeProvider>();
    await app.register(multipart, {
      limits: { fileSize: FIT_MAX_FILE_BYTES, files: 1, fields: 4, fieldSize: 64 * 1024 },
    });

    app.post('/import/check', { schema: { body: importCheckRequestSchema } }, async (request) => ({
      results: await checkImportItems(db, request.body.items),
    }));

    app.post('/import/fit', async (request, reply) => {
      if (!request.isMultipart()) return reply.code(400).send({ error: importMessages.noFile });

      let metaText: string | undefined;
      let file: { fileName: string; bytes: Buffer } | undefined;
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file') {
            const bytes = await part.toBuffer();
            if (part.fieldname === 'file') file = { fileName: cleanFileName(part.filename), bytes };
          } else if (part.fieldname === 'meta' && typeof part.value === 'string') {
            metaText = part.value;
          }
        }
      } catch (error) {
        const status = multipartErrorStatus(error);
        if (status === null) throw error;
        return reply.code(status).send({
          error: status === 413 ? importMessages.fileTooLarge : importMessages.noFile,
        });
      }
      if (!file) return reply.code(400).send({ error: importMessages.noFile });

      let metaJson: unknown;
      try {
        metaJson = JSON.parse(metaText ?? '');
      } catch {
        return reply.code(400).send({ error: importMessages.invalidMeta });
      }
      const meta = fitImportMetaSchema.safeParse(metaJson);
      if (!meta.success) {
        return reply.code(400).send({
          error: importMessages.invalidMeta,
          issues: meta.error.issues.map((issue) => ({ path: issue.path, code: issue.message })),
        });
      }

      const result = await importFitFile(db, {
        storageDir,
        bytes: new Uint8Array(file.bytes),
        fileName: file.fileName,
        meta: meta.data,
      });
      if (!result.ok) {
        return result.reason === 'conflict'
          ? reply.code(409).send(result.conflict)
          : reply.code(422).send({ error: fitErrorMessages[result.error], code: result.error });
      }
      const detail = await getActivityDetail(db, result.id);
      if (!detail) return reply.code(404).send({ error: activityMessages.notFound });
      return reply.code(201).send(detail);
    });
  };
