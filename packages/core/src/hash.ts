type Subtle = { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> };

/**
 * SHA-256 of a file as lowercase hex. Uses Web Crypto, which is a global both in browsers
 * (and Web Workers) and in Node 22, so the same code runs on both sides.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { subtle } = (globalThis as unknown as { crypto: { subtle: Subtle } }).crypto;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
