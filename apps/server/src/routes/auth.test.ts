import path from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { MAX_FAILURES } from '../auth/limiter';
import { authMessages } from '../auth/messages';
import { SESSION_COOKIE } from '../auth/plugin';
import {
  createSession,
  encodeSession,
  nowS,
  REMEMBER_TTL_S,
  RENEW_AFTER_S,
  SESSION_TTL_S,
  type SessionRole,
} from '../auth/session';
import type { AuthConfig } from '../config';
import {
  AGENT_TOKEN,
  EDITOR_PASSWORD,
  SESSION_SECRET,
  testAuth,
  VIEWER_PASSWORD,
} from '../test/auth';
import type { HealthDeps } from './health';

const health: HealthDeps = {
  checkDb: async () => {},
  migrationStatus: async () => ({ total: 1, applied: 1, pending: [] }),
  checkStorage: async () => true,
};

/** App with the real auth routes plus a few probe routes that rely on the default guards. */
async function createApp(overrides: Partial<AuthConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    webDir: path.join(tmpdir(), 'rekordy-no-web'),
    health,
    auth: testAuth(overrides),
  });
  await app.register(
    async (api) => {
      api.get('/probe', async () => ({ ok: true }));
      api.post('/probe', async () => ({ ok: true }));
      api.delete('/probe', async () => ({ ok: true }));
      api.get('/probe/editor', { onRequest: api.requireRole('editor') }, async () => ({ ok: 1 }));
      api.post('/agent/fit', async () => ({ received: true }));
    },
    { prefix: '/api' },
  );
  return app;
}

function sessionCookie(res: LightMyRequestResponse) {
  return res.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
}

async function login(app: FastifyInstance, password: string, remember = false) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { password, remember } });
}

/** Logs in and returns the `cookie` request header for later calls. */
async function loginAs(app: FastifyInstance, role: SessionRole, remember = false) {
  const res = await login(app, role === 'editor' ? EDITOR_PASSWORD : VIEWER_PASSWORD, remember);
  expect(res.statusCode).toBe(200);
  return { cookie: `${SESSION_COOKIE}=${sessionCookie(res)!.value}` };
}

function cookieFor(role: SessionRole, iat: number, secretVersion = 1, remember = false) {
  const session = createSession(role, remember, secretVersion, iat);
  const value = encodeSession(session, { secret: SESSION_SECRET, secretVersion });
  return { cookie: `${SESSION_COOKIE}=${value}` };
}

describe('POST /api/auth/login', () => {
  it('gives the viewer role for the viewer password, with a browser-session cookie', async () => {
    const app = await createApp();
    const res = await login(app, VIEWER_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: 'viewer', remember: false });
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(cookie.maxAge).toBeUndefined();
    expect(cookie.expires).toBeUndefined();
  });

  it('gives the editor role for the editor password, with a 90-day cookie when remembered', async () => {
    const app = await createApp();
    const res = await login(app, EDITOR_PASSWORD, true);
    expect(res.json()).toEqual({ role: 'editor', remember: true });
    expect(sessionCookie(res)!.maxAge).toBe(REMEMBER_TTL_S);
  });

  it('omits the Secure flag when secure cookies are off (local development)', async () => {
    const app = await createApp({ secureCookies: false });
    const res = await login(app, VIEWER_PASSWORD);
    expect(sessionCookie(res)!.secure).toBeUndefined();
  });

  it('rejects a wrong password with a generic message and no cookie', async () => {
    const app = await createApp();
    const res = await login(app, 'wrong');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: authMessages.invalidPassword });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('validates the body', async () => {
    const app = await createApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns 503 when auth is not configured', async () => {
    const app = await createApp({ viewerPasswordHash: undefined });
    const res = await login(app, VIEWER_PASSWORD);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: authMessages.notConfigured });
  });

  it('answers 429 after too many wrong passwords, even for the right one', async () => {
    const app = await createApp();
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect((await login(app, `wrong-${i}`)).statusCode).toBe(401);
    }
    const res = await login(app, EDITOR_PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: authMessages.tooManyAttempts });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not reset the failure counter on a successful login', async () => {
    const app = await createApp();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await login(app, 'wrong');
    expect((await login(app, VIEWER_PASSWORD)).statusCode).toBe(200);
    expect((await login(app, 'wrong')).statusCode).toBe(401);
    expect((await login(app, EDITOR_PASSWORD)).statusCode).toBe(429);
  });

  it('counts failures per client IP (the last X-Forwarded-For hop)', async () => {
    const app = await createApp();
    const from = (ip: string) => ({ 'x-forwarded-for': `6.6.6.6, ${ip}` });
    for (let i = 0; i < MAX_FAILURES; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: from('1.1.1.1'),
        payload: { password: 'wrong' },
      });
    }
    const blocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: from('1.1.1.1'),
      payload: { password: VIEWER_PASSWORD },
    });
    expect(blocked.statusCode).toBe(429);
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: from('2.2.2.2'),
      payload: { password: VIEWER_PASSWORD },
    });
    expect(other.statusCode).toBe(200);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session', async () => {
    const app = await createApp();
    const res = await app.inject('/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: authMessages.unauthorized });
  });

  it('returns the current role', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'editor', true);
    const res = await app.inject({ url: '/api/auth/me', headers });
    expect(res.json()).toEqual({ role: 'editor', remember: true });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'viewer');
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(res.statusCode).toBe(204);
    const cookie = sessionCookie(res)!;
    expect(cookie.value).toBe('');
    expect(cookie.expires!.getTime()).toBeLessThan(Date.now());
  });
});

describe('POST /api/auth/switch', () => {
  const switchTo = (
    app: FastifyInstance,
    headers: Record<string, string>,
    targetRole: SessionRole,
    password?: string,
  ) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/switch',
      headers,
      payload: { targetRole, ...(password === undefined ? {} : { password }) },
    });

  it('requires a session', async () => {
    const app = await createApp();
    expect((await switchTo(app, {}, 'viewer')).statusCode).toBe(401);
  });

  it('switches viewer → editor only with the editor password and keeps `remember`', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'viewer', true);

    const noPassword = await switchTo(app, headers, 'editor');
    expect(noPassword.statusCode).toBe(403);
    expect(noPassword.json()).toEqual({ error: authMessages.invalidPassword });
    expect((await switchTo(app, headers, 'editor', VIEWER_PASSWORD)).statusCode).toBe(403);

    const res = await switchTo(app, headers, 'editor', EDITOR_PASSWORD);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ role: 'editor', remember: true });
    expect(sessionCookie(res)!.maxAge).toBe(REMEMBER_TTL_S);
  });

  it('switches editor → viewer without a password', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'editor');
    const res = await switchTo(app, headers, 'viewer');
    expect(res.json()).toEqual({ role: 'viewer', remember: false });
    expect(sessionCookie(res)!.maxAge).toBeUndefined();

    const viewer = { cookie: `${SESSION_COOKIE}=${sessionCookie(res)!.value}` };
    expect(
      (await app.inject({ method: 'POST', url: '/api/probe', headers: viewer })).statusCode,
    ).toBe(403);
  });

  it('counts wrong editor passwords towards the rate limit', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'viewer');
    for (let i = 0; i < MAX_FAILURES; i++) await switchTo(app, headers, 'editor', 'wrong');
    expect((await switchTo(app, headers, 'editor', EDITOR_PASSWORD)).statusCode).toBe(429);
    expect((await login(app, EDITOR_PASSWORD)).statusCode).toBe(429);
  });
});

describe('role guards', () => {
  it('requires a session for API reads by default', async () => {
    const app = await createApp();
    expect((await app.inject('/api/probe')).statusCode).toBe(401);
  });

  it('keeps /api/health public', async () => {
    const app = await createApp();
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });

  it('lets a viewer read but not mutate', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'viewer');
    expect((await app.inject({ url: '/api/probe', headers })).statusCode).toBe(200);
    for (const method of ['POST', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/probe', headers });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: authMessages.forbidden });
    }
    expect((await app.inject({ url: '/api/probe/editor', headers })).statusCode).toBe(403);
  });

  it('lets an editor read and mutate', async () => {
    const app = await createApp();
    const headers = await loginAs(app, 'editor');
    expect((await app.inject({ url: '/api/probe', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/probe', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/probe/editor', headers })).statusCode).toBe(200);
  });

  it('rejects a forged cookie with 401 and clears it', async () => {
    const app = await createApp();
    const { cookie } = await loginAs(app, 'viewer');
    const [payload, signature] = cookie.split('=')[1]!.split('.') as [string, string];
    const forgedPayload = Buffer.from(
      Buffer.from(payload, 'base64url').toString().replace('viewer', 'editor'),
    ).toString('base64url');
    const headers = { cookie: `${SESSION_COOKIE}=${forgedPayload}.${signature}` };

    const res = await app.inject({ method: 'POST', url: '/api/probe', headers });
    expect(res.statusCode).toBe(401);
    expect(sessionCookie(res)!.value).toBe('');
    expect((await app.inject({ url: '/api/auth/me', headers })).statusCode).toBe(401);
  });

  it('rejects an expired cookie with 401', async () => {
    const app = await createApp();
    const headers = cookieFor('editor', nowS() - SESSION_TTL_S - 1);
    expect((await app.inject({ url: '/api/probe', headers })).statusCode).toBe(401);
  });

  it('rejects every session after SESSION_SECRET_VERSION is bumped', async () => {
    const app = await createApp({ sessionSecretVersion: 2 });
    expect(
      (await app.inject({ url: '/api/probe', headers: cookieFor('editor', nowS()) })).statusCode,
    ).toBe(401);
    const current = cookieFor('editor', nowS(), 2);
    expect((await app.inject({ url: '/api/probe', headers: current })).statusCode).toBe(200);
  });

  it('renews an active session (sliding expiry)', async () => {
    const app = await createApp();
    const fresh = await app.inject({ url: '/api/probe', headers: cookieFor('viewer', nowS()) });
    expect(sessionCookie(fresh)).toBeUndefined();

    const iat = nowS() - RENEW_AFTER_S - 5;
    const res = await app.inject({ url: '/api/probe', headers: cookieFor('viewer', iat, 1, true) });
    expect(res.statusCode).toBe(200);
    const renewed = sessionCookie(res)!;
    expect(renewed.maxAge).toBe(REMEMBER_TTL_S);
    const me = await app.inject({
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${renewed.value}` },
    });
    expect(me.json()).toEqual({ role: 'viewer', remember: true });
  });

  it('still returns JSON 404 for unknown API routes', async () => {
    const app = await createApp();
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
  });
});

describe('agent token', () => {
  const upload = (app: FastifyInstance, headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/api/agent/fit', headers });

  it('accepts the bearer token on /api/agent/*', async () => {
    const app = await createApp();
    const res = await upload(app, { authorization: `Bearer ${AGENT_TOKEN}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
  });

  it('rejects a missing or wrong token, and a browser session', async () => {
    const app = await createApp();
    expect((await upload(app, {})).statusCode).toBe(401);
    expect((await upload(app, { authorization: 'Bearer rs_wrong' })).statusCode).toBe(401);
    expect((await upload(app, await loginAs(app, 'editor'))).statusCode).toBe(401);
  });

  it('cannot use the UI API', async () => {
    const app = await createApp();
    const headers = { authorization: `Bearer ${AGENT_TOKEN}` };
    expect((await app.inject({ url: '/api/probe', headers })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/auth/me', headers })).statusCode).toBe(401);
  });

  it('is disabled when no agent token hash is configured', async () => {
    const app = await createApp({ agentTokenHash: undefined });
    expect((await upload(app, { authorization: `Bearer ${AGENT_TOKEN}` })).statusCode).toBe(401);
  });

  it('rate-limits wrong tokens', async () => {
    const app = await createApp();
    for (let i = 0; i < MAX_FAILURES; i++) await upload(app, { authorization: 'Bearer rs_x' });
    expect((await upload(app, { authorization: `Bearer ${AGENT_TOKEN}` })).statusCode).toBe(429);
  });
});
