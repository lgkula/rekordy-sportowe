import type mysql from 'mysql2/promise';

/**
 * Counts failed authentication attempts (wrong password or token) per key, e.g. per IP.
 * Only failures count; a successful login does not reset the counter, so knowing the
 * viewer password does not help to brute-force the editor password.
 */
export type AttemptLimiter = {
  /** Seconds until the key may try again, or 0 when it is not blocked. */
  retryAfterS: (key: string) => Promise<number>;
  recordFailure: (key: string) => Promise<void>;
};

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

type Entry = { failures: number; resetAtMs: number };

function retryAfter(entry: Entry | undefined, now: number): number {
  if (!entry || entry.resetAtMs <= now || entry.failures < MAX_FAILURES) return 0;
  return Math.ceil((entry.resetAtMs - now) / 1000);
}

/** In-process limiter for tests. Production uses the database one (Passenger-safe). */
export function createMemoryLimiter(clock: () => number = Date.now): AttemptLimiter {
  const entries = new Map<string, Entry>();
  return {
    retryAfterS: async (key) => retryAfter(entries.get(key), clock()),
    recordFailure: async (key) => {
      const now = clock();
      const entry = entries.get(key);
      if (!entry || entry.resetAtMs <= now) {
        entries.set(key, { failures: 1, resetAtMs: now + WINDOW_MS });
      } else {
        entry.failures += 1;
      }
    },
  };
}

/**
 * Limiter backed by the `auth_failures` table, shared by all app processes and kept across
 * restarts. Fixed window: it starts with the first failure and lasts WINDOW_MS.
 */
export function createDbLimiter(pool: mysql.Pool, clock: () => number = Date.now): AttemptLimiter {
  return {
    retryAfterS: async (key) => {
      const [rows] = await pool.query(
        'SELECT failures, reset_at_ms AS resetAtMs FROM auth_failures WHERE `key` = ?',
        [key],
      );
      const row = (rows as Array<{ failures: number; resetAtMs: number | string }>)[0];
      return retryAfter(
        row ? { failures: row.failures, resetAtMs: Number(row.resetAtMs) } : undefined,
        clock(),
      );
    },
    recordFailure: async (key) => {
      const now = clock();
      // `failures` is assigned first and still sees the old `reset_at_ms`.
      await pool.query(
        `INSERT INTO auth_failures (\`key\`, failures, reset_at_ms) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE
           failures = IF(reset_at_ms <= ?, 1, failures + 1),
           reset_at_ms = IF(reset_at_ms <= ?, VALUES(reset_at_ms), reset_at_ms)`,
        [key, now + WINDOW_MS, now, now],
      );
      await pool.query('DELETE FROM auth_failures WHERE reset_at_ms <= ?', [now]);
    },
  };
}
