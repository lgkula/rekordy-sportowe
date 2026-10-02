import { unzipSync } from 'fflate';

/**
 * FIT files inside a ZIP archive, e.g. Garmin Connect's "export original"
 * (`<activityId>.zip` with `<activityId>_ACTIVITY.fit`), so the user does not unpack it.
 */

export const ZIP_MAX_FILE_BYTES = 50 * 1024 * 1024;

export type ZipEntry = { name: string; bytes: Uint8Array };

export type UnzipResult =
  | {
      ok: true;
      files: ZipEntry[];
      /** FIT files left in the archive because they are larger than the import limit. */
      tooLarge: string[];
    }
  | { ok: false; error: 'zip_corrupt' | 'zip_no_fit' };

export function isZipName(name: string): boolean {
  return name.toLowerCase().endsWith('.zip');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** True for FIT files, skipping folders and macOS metadata (`__MACOSX/`, `._x.fit`). */
function isFitEntry(path: string): boolean {
  const name = baseName(path);
  return (
    !path.startsWith('__MACOSX/') && !name.startsWith('.') && name.toLowerCase().endsWith('.fit')
  );
}

/** Extracts the FIT files of an archive (in any folder), skipping files over `maxBytes`. */
export function extractFitFiles(zip: Uint8Array, maxBytes: number): UnzipResult {
  const tooLarge: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip, {
      // Decide from the central directory, before inflating anything (no zip bombs).
      filter: (file) => {
        if (!isFitEntry(file.name)) return false;
        if (file.originalSize > maxBytes) {
          tooLarge.push(baseName(file.name));
          return false;
        }
        return true;
      },
    });
  } catch {
    return { ok: false, error: 'zip_corrupt' };
  }
  const files = Object.entries(entries)
    .map(([path, bytes]) => ({ name: baseName(path), bytes }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (files.length === 0 && tooLarge.length === 0) return { ok: false, error: 'zip_no_fit' };
  return { ok: true, files, tooLarge };
}
