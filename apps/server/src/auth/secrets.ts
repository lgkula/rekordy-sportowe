import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Secret hashing with Node's built-in scrypt (no native dependencies).
 * Encoded as `scrypt:<N>:<r>:<p>:<salt>:<hash>` (salt and hash in base64url), so the cost
 * parameters can be raised later without breaking existing hashes.
 */
const PREFIX = 'scrypt';
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function scrypt(
  secret: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(secret.normalize('NFC'), salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

function maxmem(N: number, r: number): number {
  // scrypt needs about 128 * N * r bytes; leave headroom above Node's 32 MiB default check.
  return 256 * N * r;
}

export async function hashSecret(secret: string): Promise<string> {
  const { N, r, p } = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(secret, salt, KEY_BYTES, { N, r, p, maxmem: maxmem(N, r) });
  return [PREFIX, N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

type ParsedHash = { N: number; r: number; p: number; salt: Buffer; key: Buffer };

function parseHash(encoded: string): ParsedHash | null {
  const parts = encoded.split(':');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return null;
  if (N > 2 ** 20 || r > 32 || p > 16) return null;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const key = Buffer.from(parts[5]!, 'base64url');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

export function isValidHash(encoded: string): boolean {
  return parseHash(encoded) !== null;
}

/** Constant-time check of `secret` against an encoded hash. Malformed hashes never match. */
export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const parsed = parseHash(encoded);
  if (!parsed) return false;
  const { N, r, p, salt, key } = parsed;
  const candidate = await scrypt(secret, salt, key.length, { N, r, p, maxmem: maxmem(N, r) });
  return timingSafeEqual(candidate, key);
}

/** Random API token for the Windows sync agent (shown once, only its hash is stored). */
export function generateToken(): string {
  return `rs_${randomBytes(32).toString('base64url')}`;
}

/** Random HMAC key for session cookies. */
export function generateSessionSecret(): string {
  return randomBytes(48).toString('base64url');
}
