import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

/** Path of a stored original FIT file: `storage/fit/<yyyy>/<sha256>.fit.gz` (PLAN.md 3.2). */
export function fitFilePath(storageDir: string, year: string, sha256: string): string {
  return path.join(storageDir, 'fit', year, `${sha256}.fit.gz`);
}

/**
 * Keeps the original file (gzipped) so that records can be recomputed if the rules change.
 * The name is the content hash, so storing the same file twice is a no-op. Written to a
 * temporary file first and renamed, so a parallel request never sees half a file.
 */
export async function storeFitFile(
  storageDir: string,
  localDate: string,
  sha256: string,
  bytes: Uint8Array,
): Promise<string> {
  const target = fitFilePath(storageDir, localDate.slice(0, 4), sha256);
  try {
    await access(target);
    return target;
  } catch {
    // Not stored yet.
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, await gzipAsync(bytes));
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return target;
}
