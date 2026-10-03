import fastifyCookie from '@fastify/cookie';
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import type { AuthConfig } from '../config';
import type { AttemptLimiter } from './limiter';
import { authMessages } from './messages';
import { verifySecret } from './secrets';
import {
  createSession,
  decodeSession,
  encodeSession,
  needsRenewal,
  REMEMBER_TTL_S,
  type Session,
  type SessionGrant,
  type SessionKeys,
  type SessionRole,
} from './session';

export const SESSION_COOKIE = 'rs_session';

/**
 * Who may call a route. Default when a route does not set `config.access`:
 * `/api/agent/*` → agent, GET/HEAD → viewer, anything else (mutations) → editor.
 */
export type Access = 'public' | 'viewer' | 'editor' | 'agent';

export type AuthOptions = {
  config: AuthConfig;
  limiter: AttemptLimiter;
};

export type Auth = {
  /** Both passwords and the session secret are set. */
  configured: boolean;
  /** Role matching the password (editor checked first), or null. */
  matchPassword: (password: string) => Promise<SessionRole | null>;
  verifyEditorPassword: (password: string) => Promise<boolean>;
  startSession: (reply: FastifyReply, grant: SessionGrant) => Session;
  endSession: (reply: FastifyReply) => void;
  /** Rate-limit key for the client. */
  limiterKey: (request: FastifyRequest) => string;
  limiter: AttemptLimiter;
};

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    /** Valid browser session from the cookie, or null. Not set for agent requests. */
    session: Session | null;
  }
  interface FastifyInstance {
    auth: Auth;
    requireRole: (role: SessionRole) => onRequestAsyncHookHandler;
    requireAgent: onRequestAsyncHookHandler;
  }
}

function isApiUrl(url: string): boolean {
  return url === '/api' || url.startsWith('/api/');
}

function defaultAccess(request: FastifyRequest): Access {
  const url = request.routeOptions.url ?? request.url;
  if (url.startsWith('/api/agent/')) return 'agent';
  return ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ? 'viewer' : 'editor';
}

/** Sends `{ error }` with the status code; returning the reply stops the hook chain. */
function fail(reply: FastifyReply, statusCode: number, error: string): FastifyReply {
  return reply.code(statusCode).send({ error });
}

export const authPlugin = fp<AuthOptions>(
  async (app, { config, limiter }) => {
    await app.register(fastifyCookie);

    const keys: SessionKeys | null = config.sessionSecret
      ? { secret: config.sessionSecret, secretVersion: config.sessionSecretVersion }
      : null;

    const cookieOptions = {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'strict',
      path: '/',
    } as const;

    function setCookie(reply: FastifyReply, session: Session): void {
      if (!keys) throw new Error('SESSION_SECRET is not set');
      reply.setCookie(SESSION_COOKIE, encodeSession(session, keys), {
        ...cookieOptions,
        // Without maxAge the browser drops the cookie when it closes ("session cookie");
        // the server still enforces `exp` from the signed payload.
        ...(session.remember ? { maxAge: REMEMBER_TTL_S } : {}),
      });
    }

    const auth: Auth = {
      configured: Boolean(keys && config.viewerPasswordHash && config.editorPasswordHash),
      matchPassword: async (password) => {
        if (config.editorPasswordHash && (await verifySecret(password, config.editorPasswordHash)))
          return 'editor';
        if (config.viewerPasswordHash && (await verifySecret(password, config.viewerPasswordHash)))
          return 'viewer';
        return null;
      },
      verifyEditorPassword: async (password) =>
        Boolean(config.editorPasswordHash) &&
        (await verifySecret(password, config.editorPasswordHash!)),
      startSession: (reply, grant) => {
        const session = createSession(grant, config.sessionSecretVersion);
        setCookie(reply, session);
        return session;
      },
      endSession: (reply) => {
        reply.clearCookie(SESSION_COOKIE, cookieOptions);
      },
      limiterKey: (request) => `ip:${request.ip}`,
      limiter,
    };

    const requireRole =
      (role: SessionRole): onRequestAsyncHookHandler =>
      async (request, reply) => {
        const session = request.session;
        if (!session) return fail(reply, 401, authMessages.unauthorized);
        if (role === 'editor' && session.role !== 'editor') {
          return fail(reply, 403, authMessages.forbidden);
        }
      };

    const requireAgent: onRequestAsyncHookHandler = async (request, reply) => {
      const token = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
      if (!token || !config.agentTokenHash) return fail(reply, 401, authMessages.invalidToken);
      const key = auth.limiterKey(request);
      if ((await limiter.retryAfterS(key)) > 0) {
        return fail(reply, 429, authMessages.tooManyAttempts);
      }
      if (!(await verifySecret(token, config.agentTokenHash))) {
        await limiter.recordFailure(key);
        request.log.warn({ ip: request.ip }, 'Invalid agent token');
        return fail(reply, 401, authMessages.invalidToken);
      }
    };

    app.decorate('auth', auth);
    app.decorate('requireRole', requireRole);
    app.decorate('requireAgent', requireAgent);
    app.decorateRequest('session', null);

    const guards: Record<Exclude<Access, 'public'>, onRequestAsyncHookHandler> = {
      viewer: requireRole('viewer'),
      editor: requireRole('editor'),
      agent: requireAgent,
    };

    app.addHook('onRequest', async function (request, reply) {
      if (!isApiUrl(request.url)) return;
      // Unknown routes fall through to the JSON 404 handler.
      if (!request.routeOptions.url) return;

      const access = request.routeOptions.config.access ?? defaultAccess(request);
      if (access === 'agent') return guards.agent.call(this, request, reply);

      const cookie = request.cookies[SESSION_COOKIE];
      const session = keys ? decodeSession(cookie, keys) : null;
      if (cookie && !session) auth.endSession(reply);
      if (session && needsRenewal(session)) {
        // Sliding expiry: an active user is never logged out by the TTL.
        Object.assign(session, createSession(session, session.secretVersion));
        setCookie(reply, session);
      }
      request.session = session;

      if (access === 'public') return;
      return guards[access].call(this, request, reply);
    });
  },
  { name: 'auth', fastify: '5.x' },
);
