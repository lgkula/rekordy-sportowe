import type { AuthOptions } from '../auth/plugin';
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
