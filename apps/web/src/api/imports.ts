import type {
  ActivityDetail,
  FitImportMeta,
  ImportCheckItem,
  ImportCheckResponse,
  ImportCheckResult,
} from '@rekordy/core';
import { apiFetch } from './client';

/** The server accepts up to 500 items per check; smaller batches keep requests short. */
const CHECK_BATCH = 200;

/** `POST /api/import/check` for any number of files. */
export async function checkImport(items: ImportCheckItem[]): Promise<ImportCheckResult[]> {
  const results: ImportCheckResult[] = [];
  for (let i = 0; i < items.length; i += CHECK_BATCH) {
    const response = await apiFetch<ImportCheckResponse>('/api/import/check', {
      method: 'POST',
      body: { items: items.slice(i, i + CHECK_BATCH) },
    });
    results.push(...response.results);
  }
  return results;
}

/** `POST /api/import/fit`: one approved file with the choices from the review. */
export function uploadFit(file: File, meta: FitImportMeta): Promise<ActivityDetail> {
  const form = new FormData();
  // The meta field goes first, so the server has it before the file stream.
  form.append('meta', JSON.stringify(meta));
  form.append('file', file, file.name);
  return apiFetch<ActivityDetail>('/api/import/fit', { method: 'POST', body: form });
}
