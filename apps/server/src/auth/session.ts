import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session cookie: `<payload>.<signature>`, both base64url. The payload is JSON,
 * the signature is HMAC-SHA256 over the encoded payload with `SESSION_SECRET`.
 * Nothing is stored on the server, so it works across Passenger processes and restarts.
 */
export type SessionRole = 'viewer' | 'editor';

export type Session = {
  role: SessionRole;
  /** "Zapamiętaj w tej przeglądarce": persistent cookie instead of a browser-session one. */
  remember: boolean;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expires at (unix seconds). */
  exp: number;
  /** `SESSION_SECRET_VERSION` at issue time; bumping it invalidates every session. */
  secretVersion: number;
};

export type SessionKeys = { secret: string; secretVersion: number };

/** Sliding lifetimes: every renewal moves `exp` forward by the full TTL. */
export const SESSION_TTL_S = 96 * 3600;
export const REMEMBER_TTL_S = 90 * 24 * 3600;
/** A valid cookie older than this is re-issued with a fresh expiry. */
export const RENEW_AFTER_S = 3600;

export function nowS(): number {
  return Math.floor(Date.now() / 1000);
}

export function ttlFor(remember: boolean): number {
  return remember ? REMEMBER_TTL_S : SESSION_TTL_S;
}

export function createSession(
  role: SessionRole,
  remember: boolean,
  secretVersion: number,
  now = nowS(),
): Session {
  return { role, remember, iat: now, exp: now + ttlFor(remember), secretVersion };
}

function sign(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

export function encodeSession(session: Session, keys: SessionKeys): string {
  const payload = {
    r: session.role,
    m: session.remember ? 1 : 0,
    i: session.iat,
    e: session.exp,
    v: session.secretVersion,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded, keys.secret).toString('base64url')}`;
}

/** Returns the session, or null when the cookie is malformed, tampered, expired or revoked. */
export function decodeSession(
  value: string | undefined,
  keys: SessionKeys,
  now = nowS(),
): Session | null {
  if (!value) return null;
  const [encoded, signature, ...rest] = value.split('.');
  if (!encoded || !signature || rest.length > 0) return null;

  const expected = sign(encoded, keys.secret);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;
  const { r, m, i, e, v } = payload as Record<string, unknown>;
  if (r !== 'viewer' && r !== 'editor') return null;
  if (typeof i !== 'number' || typeof e !== 'number' || typeof v !== 'number') return null;
  if (v !== keys.secretVersion || e <= now) return null;

  return { role: r, remember: m === 1, iat: i, exp: e, secretVersion: v };
}

export function needsRenewal(session: Session, now = nowS()): boolean {
  return now - session.iat >= RENEW_AFTER_S;
}
