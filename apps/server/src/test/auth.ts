import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE, type AuthOptions } from '../auth/plugin';
import type { SessionRole } from '../auth/session';
import { createMemoryLimiter, type AttemptLimiter } from '../auth/limiter';
import { hashSecret } from '../auth/secrets';
import type { AuthConfig } from '../config';

/** Test credentials and auth options (hashes computed once per test file). */
export const VIEWER_PASSWORD = 'lk';
export const EDITOR_PASSWORD = 'correct horse battery staple';
export const AGENT_TOKEN = 'rs_test-agent-token';
export const SESSION_SECRET = 'test-session-secret-0123456789-abcdefghij';

const hashes = {
  viewer: await hashSecret(VIEWER_PASSWORD),
  editor: await hashSecret(EDITOR_PASSWORD),
  agent: await hashSecret(AGENT_TOKEN),
};

export function testAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    viewerPasswordHash: hashes.viewer,
    editorPasswordHash: hashes.editor,
    agentTokenHash: hashes.agent,
    sessionSecret: SESSION_SECRET,
    sessionSecretVersion: 1,
    secureCookies: true,
    ...overrides,
  };
}

export function testAuth(
  overrides: Partial<AuthConfig> = {},
  limiter: AttemptLimiter = createMemoryLimiter(),
): AuthOptions {
  return { config: testAuthConfig(overrides), limiter };
}

/** Logs in through the API and returns the `cookie` request header for later calls. */
export async function loginHeaders(
  app: FastifyInstance,
  role: SessionRole,
): Promise<{ cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { password: role === 'editor' ? EDITOR_PASSWORD : VIEWER_PASSWORD },
  });
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (res.statusCode !== 200 || !cookie) throw new Error(`Login as ${role} failed`);
  return { cookie: `${SESSION_COOKIE}=${cookie.value}` };
}
