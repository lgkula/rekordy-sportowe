import {
  fitImportMetaSchema,
  type ActivityListItem,
  type FitImportMeta,
  type ImportCheckItem,
  type ImportCheckResult,
  type Sport,
} from '@rekordy/core';
import type { FitActivity, FitDetails, FitErrorCode, FitParseResult } from '@rekordy/core/fit';

/**
 * State of the FIT import (PLAN.md 6.2), kept free of React so it can be unit-tested:
 * parse in the browser → duplicate check → review of each new file → upload.
 */

export type ImportStatus =
  | 'parsing'
  | 'checking'
  /** Ready for review. */
  | 'new'
  /** Ready for review, but a similar activity exists: saving needs a confirmation. */
  | 'similar'
  | 'duplicate'
  | 'unsupported'
  | 'error'
  | 'uploading'
  | 'saved'
  | 'skipped';

export type ItemError =
  | FitErrorCode
  | 'worker_failed'
  | 'check_failed'
  | 'zip_corrupt'
  | 'zip_no_fit'
  /** Over the FIT size limit (a dropped file or one inside an archive). */
  | 'too_large';

export type DuplicateInfo =
  | { field: 'externalId' | 'fileName' | 'fileSha256'; activity: ActivityListItem }
  /** The same file was dropped twice in this import. */
  | { field: 'externalId' | 'fileName' | 'fileSha256'; sameAsFile: string };

/** Fields the user can change in the review step. */
export type ReviewValues = {
  name: string;
  sport: Sport;
  isRace: boolean;
  isHidden: boolean;
  activityUrl: string;
  notes: string;
  /** Save even though a similar activity exists. */
  confirmSimilar: boolean;
};

export type ImportItem = {
  key: string;
  file: File;
  /** Name of the ZIP archive the file was extracted from. */
  archiveName?: string;
  status: ImportStatus;
  activity?: FitActivity;
  details?: FitDetails;
  error?: ItemError;
  /** Error text from the server when saving failed (the item stays reviewable). */
  uploadError?: string;
  /** Raw FIT sport for unsupported files, e.g. `cycling`. */
  fitSport?: string;
  duplicate?: DuplicateInfo;
  similar?: ActivityListItem[];
  values?: ReviewValues;
  savedId?: number;
};

let nextKey = 0;

export function newItem(file: File, archiveName?: string): ImportItem {
  nextKey += 1;
  return { key: `f${nextKey}`, file, status: 'parsing', ...(archiveName ? { archiveName } : {}) };
}

/** An item that failed before parsing (bad archive, file too large, …). */
export function failedItem(file: File, error: ItemError, archiveName?: string): ImportItem {
  return { ...newItem(file, archiveName), status: 'error', error };
}

export function defaultValues(activity: FitActivity): ReviewValues {
  return {
    name: activity.name,
    sport: activity.sport,
    isRace: activity.isRace,
    isHidden: false,
    activityUrl: activity.activityUrl ?? '',
    notes: '',
    confirmSimilar: false,
  };
}

/** Applies the worker's parse result: ready for the duplicate check, or a final status. */
export function applyParseResult(item: ImportItem, result: FitParseResult): ImportItem {
  if (result.ok) {
    return {
      ...item,
      status: 'checking',
      activity: result.activity,
      details: result.details,
      values: defaultValues(result.activity),
    };
  }
  if (result.error === 'unsupported_sport') {
    return { ...item, status: 'unsupported', fitSport: result.fitSport };
  }
  return { ...item, status: 'error', error: result.error };
}

const IDENTITY_FIELDS = ['externalId', 'fileName', 'fileSha256'] as const;

/**
 * Marks files that repeat an earlier file of the same import (dropped twice, or a renamed
 * copy) as duplicates, before asking the server.
 */
export function markBatchDuplicates(items: readonly ImportItem[]): ImportItem[] {
  const seen = new Map<string, string>();
  return items.map((item) => {
    const a = item.activity;
    if (!a || item.status === 'error' || item.status === 'unsupported') return item;
    if (item.status === 'checking') {
      for (const field of IDENTITY_FIELDS) {
        const value = a[field];
        const first = value ? seen.get(`${field}:${value}`) : undefined;
        if (first) {
          return { ...item, status: 'duplicate', duplicate: { field, sameAsFile: first } };
        }
      }
    }
    if (item.status !== 'duplicate' && item.status !== 'skipped') {
      for (const field of IDENTITY_FIELDS) {
        const value = a[field];
        if (value && !seen.has(`${field}:${value}`)) seen.set(`${field}:${value}`, item.file.name);
      }
    }
    return item;
  });
}

export function toCheckItem(item: ImportItem): ImportCheckItem | null {
  const a = item.activity;
  if (!a) return null;
  return {
    key: item.key,
    fileName: a.fileName,
    fileSha256: a.fileSha256,
    externalId: a.externalId ?? null,
    startTimeUtc: a.startTimeUtc,
    localDate: a.localDate,
    distanceM: a.distanceM,
  };
}

export function applyCheckResult(item: ImportItem, result: ImportCheckResult): ImportItem {
  switch (result.status) {
    case 'new':
      return { ...item, status: 'new' };
    case 'similar':
      return { ...item, status: 'similar', similar: result.similar };
    case 'duplicate':
      return {
        ...item,
        status: 'duplicate',
        duplicate: { field: result.field, activity: result.activity },
      };
  }
}

/** Files waiting for the user's decision, in the order they were added. */
export function reviewQueue(items: readonly ImportItem[]): ImportItem[] {
  return items.filter((item) => item.status === 'new' || item.status === 'similar');
}

/** True while some file is still being parsed, checked or saved. */
export function isBusy(items: readonly ImportItem[]): boolean {
  return items.some((i) => ['parsing', 'checking', 'uploading'].includes(i.status));
}

/** Items "Zatwierdź wszystkie pozostałe" may save without asking: no unconfirmed warning. */
export function approvableWithoutReview(items: readonly ImportItem[]): ImportItem[] {
  return reviewQueue(items).filter(
    (item) => item.status === 'new' || item.values?.confirmSimilar === true,
  );
}

export type MetaResult =
  | { ok: true; meta: FitImportMeta }
  | { ok: false; errors: Partial<Record<keyof ReviewValues, string>> };

/** Review values → the upload's `meta`, validated with the server's schema. */
export function toMeta(values: ReviewValues, needsConfirmation: boolean): MetaResult {
  const parsed = fitImportMetaSchema.safeParse({
    name: values.name,
    sport: values.sport,
    isRace: values.isRace,
    isHidden: values.isHidden,
    activityUrl: values.activityUrl.trim(),
    notes: values.notes,
    confirmDuplicate: needsConfirmation ? values.confirmSimilar : undefined,
  });
  if (parsed.success) return { ok: true, meta: parsed.data };
  const errors: Partial<Record<keyof ReviewValues, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof ReviewValues;
    errors[field] ??= issue.message;
  }
  return { ok: false, errors };
}

export type ImportSummary = Record<
  'saved' | 'skipped' | 'duplicate' | 'error' | 'unsupported' | 'pending',
  number
>;

export function summarize(items: readonly ImportItem[]): ImportSummary {
  const summary: ImportSummary = {
    saved: 0,
    skipped: 0,
    duplicate: 0,
    error: 0,
    unsupported: 0,
    pending: 0,
  };
  for (const item of items) {
    if (item.status in summary) summary[item.status as keyof ImportSummary] += 1;
    else summary.pending += 1;
  }
  return summary;
}

/** Pace in s/km from totals, for the preview. */
export function averagePace(activity: FitActivity): number {
  return activity.durationS / (activity.distanceM / 1000);
}
