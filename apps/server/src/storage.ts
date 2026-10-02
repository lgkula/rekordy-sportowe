import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Ensures the storage directory exists and that the app process can write to it. */
export async function checkStorageWritable(storageDir: string): Promise<boolean> {
  try {
    await mkdir(storageDir, { recursive: true });
    const probe = path.join(storageDir, `.write-test-${process.pid}-${Date.now()}`);
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}
