import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  decodeSession,
  encodeSession,
  needsRenewal,
  REMEMBER_TTL_S,
  RENEW_AFTER_S,
  SESSION_TTL_S,
} from './session';

const keys = { secret: 'unit-test-secret-0123456789abcdefghijkl', secretVersion: 3 };
const now = 1_800_000_000;

/** Re-encodes the cookie payload after `edit`, optionally re-signing it with the real key. */
function editPayload(cookie: string, edit: (json: string) => string, resign: boolean): string {
  const [payload, signature] = cookie.split('.') as [string, string];
  const json = edit(Buffer.from(payload, 'base64url').toString());
  const encoded = Buffer.from(json).toString('base64url');
  const newSignature = resign
    ? createHmac('sha256', keys.secret).update(encoded).digest('base64url')
    : signature;
  return `${encoded}.${newSignature}`;
}

describe('session cookie', () => {
  it('round-trips a session', () => {
    const session = createSession('editor', true, 3, now);
    expect(session).toEqual({
      role: 'editor',
      remember: true,
      iat: now,
      exp: now + REMEMBER_TTL_S,
      secretVersion: 3,
    });
    expect(decodeSession(encodeSession(session, keys), keys, now + 10)).toEqual(session);
  });

  it('uses 96 h for a non-remembered session and 90 days for a remembered one', () => {
    expect(SESSION_TTL_S).toBe(96 * 3600);
    expect(REMEMBER_TTL_S).toBe(90 * 86400);
    expect(createSession('viewer', false, 3, now).exp).toBe(now + SESSION_TTL_S);
  });

  it('rejects a tampered payload', () => {
    const cookie = encodeSession(createSession('viewer', false, 3, now), keys);
    const forged = editPayload(cookie, (json) => json.replace('viewer', 'editor'), false);
    expect(decodeSession(forged, keys, now)).toBeNull();
  });

  it('rejects a cookie signed with another secret', () => {
    const cookie = encodeSession(createSession('editor', false, 3, now), {
      ...keys,
      secret: 'another-secret-0123456789abcdefghijklmnop',
    });
    expect(decodeSession(cookie, keys, now)).toBeNull();
  });

  it('rejects an expired session', () => {
    const session = createSession('viewer', false, 3, now);
    const cookie = encodeSession(session, keys);
    expect(decodeSession(cookie, keys, session.exp - 1)).not.toBeNull();
    expect(decodeSession(cookie, keys, session.exp)).toBeNull();
  });

  it('rejects sessions from another secret version', () => {
    const cookie = encodeSession(createSession('editor', true, 3, now), keys);
    expect(decodeSession(cookie, { ...keys, secretVersion: 4 }, now)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const value of [undefined, '', 'abc', 'a.b', 'a.b.c', '.', 'eyJ9.AAAA']) {
      expect(decodeSession(value, keys, now)).toBeNull();
    }
  });

  it('rejects a validly signed payload with an unknown role', () => {
    const cookie = encodeSession(createSession('editor', false, 3, now), keys);
    const forged = editPayload(cookie, (json) => json.replace('editor', 'admin'), true);
    expect(decodeSession(forged, keys, now)).toBeNull();
  });

  it('asks for renewal once the cookie is older than RENEW_AFTER_S', () => {
    const session = createSession('viewer', false, 3, now);
    expect(needsRenewal(session, now + RENEW_AFTER_S - 1)).toBe(false);
    expect(needsRenewal(session, now + RENEW_AFTER_S)).toBe(true);
  });
});
