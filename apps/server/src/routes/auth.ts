import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authMessages } from '../auth/messages';
import type { SessionRole } from '../auth/session';

export type AuthResponse = { role: SessionRole; remember: boolean };

const password = z.string().min(1).max(256);

const loginBody = z.object({
  password,
  remember: z.boolean().default(false),
});

const switchBody = z.object({
  targetRole: z.enum(['viewer', 'editor']),
  password: password.optional(),
});

/** `/api/auth/*`: login, logout, current session and role switch (PLAN.md 4.5). */
export const authRoutes: FastifyPluginAsync = async (base) => {
  const app = base.withTypeProvider<ZodTypeProvider>();
  const { auth } = app;

  /** Replies 429 when the client has too many failed attempts; returns true if it did. */
  async function rejectIfLimited(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const retryAfterS = await auth.limiter.retryAfterS(auth.limiterKey(request));
    if (retryAfterS === 0) return false;
    reply
      .code(429)
      .header('retry-after', String(retryAfterS))
      .send({ error: authMessages.tooManyAttempts });
    return true;
  }

  async function recordFailure(request: FastifyRequest, action: string): Promise<void> {
    await auth.limiter.recordFailure(auth.limiterKey(request));
    request.log.warn({ ip: request.ip, action }, 'Wrong password');
  }

  app.post(
    '/auth/login',
    { config: { access: 'public' }, schema: { body: loginBody } },
    async (request, reply) => {
      if (!auth.configured) return reply.code(503).send({ error: authMessages.notConfigured });
      if (await rejectIfLimited(request, reply)) return reply;

      const role = await auth.matchPassword(request.body.password);
      if (!role) {
        await recordFailure(request, 'login');
        return reply.code(401).send({ error: authMessages.invalidPassword });
      }
      const session = auth.startSession(reply, role, request.body.remember);
      return { role: session.role, remember: session.remember } satisfies AuthResponse;
    },
  );

  app.post('/auth/logout', { config: { access: 'public' } }, async (_request, reply) => {
    auth.endSession(reply);
    return reply.code(204).send();
  });

  app.get('/auth/me', { config: { access: 'public' } }, async (request, reply) => {
    const session = request.session;
    if (!session) return reply.code(401).send({ error: authMessages.unauthorized });
    return { role: session.role, remember: session.remember } satisfies AuthResponse;
  });

  app.post(
    '/auth/switch',
    { config: { access: 'viewer' }, schema: { body: switchBody } },
    async (request, reply) => {
      // The global guard guarantees a session here.
      const current = request.session!;
      const { targetRole } = request.body;

      if (targetRole === 'editor' && current.role !== 'editor') {
        if (await rejectIfLimited(request, reply)) return reply;
        const ok = await auth.verifyEditorPassword(request.body.password ?? '');
        if (!ok) {
          await recordFailure(request, 'switch');
          // 403, not 401: the session itself is still valid.
          return reply.code(403).send({ error: authMessages.invalidPassword });
        }
      }

      // `remember` stays as it was at login.
      const session = auth.startSession(reply, targetRole, current.remember);
      return { role: session.role, remember: session.remember } satisfies AuthResponse;
    },
  );
};
