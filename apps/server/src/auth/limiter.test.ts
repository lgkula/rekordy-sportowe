import { describe, expect, it } from 'vitest';
import { createMemoryLimiter, MAX_FAILURES, WINDOW_MS } from './limiter';

describe('memory limiter', () => {
  it('blocks a key after MAX_FAILURES failures until the window ends', async () => {
    let now = 1_000_000;
    const limiter = createMemoryLimiter(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) await limiter.recordFailure('ip:a');
    expect(await limiter.retryAfterS('ip:a')).toBe(0);

    await limiter.recordFailure('ip:a');
    expect(await limiter.retryAfterS('ip:a')).toBe(WINDOW_MS / 1000);
    expect(await limiter.retryAfterS('ip:b')).toBe(0);

    now += WINDOW_MS - 1000;
    expect(await limiter.retryAfterS('ip:a')).toBe(1);
    now += 1000;
    expect(await limiter.retryAfterS('ip:a')).toBe(0);

    // A new window starts from scratch.
    await limiter.recordFailure('ip:a');
    expect(await limiter.retryAfterS('ip:a')).toBe(0);
  });
});
