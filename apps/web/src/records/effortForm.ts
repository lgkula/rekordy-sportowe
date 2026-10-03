import {
  editedEffort,
  effortPatchSchema,
  formatDistanceInput,
  formatDurationInput,
  parseDistanceKm,
  parseDuration,
  type DistanceKey,
  type EffortPatchInput,
  type EffortValues,
  type RecordEntry,
  type ValidationCode,
} from '@rekordy/core';

/** Edit form of a result (records view): text as typed, parsed on submit. */
export type EffortFormValues = { duration: string; distance: string; activityUrl: string };
export type EffortFormErrors = Partial<Record<keyof EffortFormValues, ValidationCode>>;

/** The time over the actual distance; tolerance results carry only the pace in the API. */
export function entryDurationS(
  entry: Pick<RecordEntry, 'durationS' | 'paceSPerKm' | 'actualDistanceM'>,
): number {
  return entry.durationS ?? Math.round((entry.paceSPerKm * entry.actualDistanceM) / 100) / 10;
}

export function effortFormValues(entry: RecordEntry): EffortFormValues {
  return {
    duration: formatDurationInput(entryDurationS(entry)),
    distance: formatDistanceInput(entry.actualDistanceM),
    activityUrl: entry.activityUrl ?? '',
  };
}

/** What the result would become (live preview in the form); null when it does not qualify. */
export function effortPreview(
  distanceKey: DistanceKey,
  values: EffortFormValues,
): EffortValues | null {
  const durationS = parseDuration(values.duration);
  const distanceM = parseDistanceKm(values.distance);
  return durationS === null || distanceM === null
    ? null
    : editedEffort(distanceKey, distanceM, durationS);
}

export type EffortFormResult =
  { ok: true; patch: EffortPatchInput | null } | { ok: false; errors: EffortFormErrors };

/**
 * Validates the form and builds the PATCH with only what changed: the time and distance go
 * together (they mark the result as edited), the link alone does not. `patch` is null when
 * nothing changed.
 */
export function buildEffortPatch(
  distanceKey: DistanceKey,
  values: EffortFormValues,
  initial: EffortFormValues,
): EffortFormResult {
  const errors: EffortFormErrors = {};
  const durationS = parseDuration(values.duration);
  const distanceM = parseDistanceKm(values.distance);
  if (durationS === null) errors.duration = 'invalid_duration';
  if (distanceM === null) errors.distance = 'invalid_distance';
  if (
    durationS !== null &&
    distanceM !== null &&
    !editedEffort(distanceKey, distanceM, durationS)
  ) {
    errors.distance = 'effort_distance_out_of_range';
  }

  const activityUrl = values.activityUrl.trim();
  const urlCheck = effortPatchSchema.safeParse({ activityUrl });
  if (!urlCheck.success) {
    const code = urlCheck.error.issues[0]?.message as ValidationCode | undefined;
    errors.activityUrl = code ?? 'invalid_url';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const patch: EffortPatchInput = {};
  const valuesChanged =
    durationS !== parseDuration(initial.duration) ||
    distanceM !== parseDistanceKm(initial.distance);
  if (valuesChanged) {
    patch.durationS = durationS!;
    patch.actualDistanceM = distanceM!;
  }
  if (activityUrl !== initial.activityUrl.trim()) patch.activityUrl = activityUrl || null;
  return { ok: true, patch: Object.keys(patch).length > 0 ? patch : null };
}
