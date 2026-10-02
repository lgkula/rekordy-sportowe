import { describe, expect, it } from 'vitest';
import {
  generateSessionSecret,
  generateToken,
  hashSecret,
  isValidHash,
  verifySecret,
} from './secrets';

describe('hashSecret / verifySecret', () => {
  it('verifies the right secret and rejects a wrong one', async () => {
    const hash = await hashSecret('lk');
    expect(hash).toMatch(/^scrypt:16384:8:1:[\w-]+:[\w-]+$/);
    expect(isValidHash(hash)).toBe(true);
    await expect(verifySecret('lk', hash)).resolves.toBe(true);
    await expect(verifySecret('LK', hash)).resolves.toBe(false);
    await expect(verifySecret('', hash)).resolves.toBe(false);
  });

  it('uses a random salt', async () => {
    const [a, b] = await Promise.all([hashSecret('same'), hashSecret('same')]);
    expect(a).not.toBe(b);
    await expect(verifySecret('same', b)).resolves.toBe(true);
  });

  it('treats Unicode-equivalent passwords as equal (NFC)', async () => {
    const hash = await hashSecret('Zażółć');
    await expect(verifySecret('Zażółć', hash)).resolves.toBe(true);
  });

  it('rejects malformed or tampered hashes', async () => {
    const hash = await hashSecret('secret');
    const parts = hash.split(':');
    const tampered = [...parts.slice(0, 5), Buffer.alloc(32, 1).toString('base64url')].join(':');
    await expect(verifySecret('secret', tampered)).resolves.toBe(false);
    const malformed = [
      '',
      'plain',
      'bcrypt:1:2:3:aa:bb',
      'scrypt:x:8:1:aa:bb',
      'scrypt:16384:8:1::',
    ];
    for (const bad of malformed) {
      expect(isValidHash(bad)).toBe(false);
      await expect(verifySecret('secret', bad)).resolves.toBe(false);
    }
    // Absurd cost parameters are refused instead of exhausting memory.
    expect(isValidHash(['scrypt', 2 ** 24, 8, 1, parts[4], parts[5]].join(':'))).toBe(false);
  });
});

describe('random secrets', () => {
  it('generates distinct agent tokens and session secrets', () => {
    expect(generateToken()).toMatch(/^rs_[\w-]{43}$/);
    expect(generateToken()).not.toBe(generateToken());
    expect(generateSessionSecret().length).toBeGreaterThanOrEqual(64);
  });
});
