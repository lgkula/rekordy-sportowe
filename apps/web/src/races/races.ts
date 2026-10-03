import {
  editionPace,
  ENABLED_SPORTS,
  formatDistance,
  formatDistanceInput,
  formatLocalDate,
  parseDistanceKm,
  type ActivityDetail,
  type EventEdition,
  type EventListItem,
  type Sport,
  type ValidationCode,
} from '@rekordy/core';

/** Races view logic kept free of React, so it can be unit-tested. */

export function readSport(params: URLSearchParams): Sport {
  const sport = params.get('sport') as Sport | null;
  return sport && ENABLED_SPORTS.includes(sport) ? sport : ENABLED_SPORTS[0]!;
}

/** The edition of a race activity without an event (its one-edition entry in the list). */
export function editionOf(activity: ActivityDetail): EventEdition {
  return {
    activityId: activity.id,
    activityName: activity.name,
    editionLabel: activity.editionLabel,
    localDate: activity.localDate,
    startTimeUtc: activity.startTimeUtc,
    distanceM: activity.distanceM,
    durationS: activity.durationS,
    paceSPerKm: editionPace(activity.distanceM, activity.durationS),
    elevationGainM: activity.elevationGainM,
    isHidden: activity.isHidden,
  };
}

/** Where the best pace comes from: the edition label, otherwise its date. */
export function bestEditionLabel(item: EventListItem): string | null {
  const best = item.bestEdition;
  if (!best) return null;
  return best.editionLabel ?? formatLocalDate(best.localDate);
}

/** Moves `activeId` to the place of `overId` in the manual order of events. */
export function reorderIds(ids: readonly number[], activeId: number, overId: number): number[] {
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export type EventFormValues = { name: string; distance: string };

export function eventFormValues(item: EventListItem | null, name = ''): EventFormValues {
  return {
    name: item?.name ?? name,
    distance: item?.displayDistanceM == null ? '' : formatDistanceInput(item.displayDistanceM),
  };
}

export type EventFormResult =
  | { ok: true; name: string; displayDistanceM: number | null }
  | { ok: false; errors: Partial<Record<keyof EventFormValues, ValidationCode>> };

/** Validates the event form; an empty distance means "computed from the editions". */
export function parseEventForm(values: EventFormValues): EventFormResult {
  const errors: Partial<Record<keyof EventFormValues, ValidationCode>> = {};
  const name = values.name.trim();
  if (name === '') errors.name = 'required';
  else if (name.length > 200) errors.name = 'too_long';
  let displayDistanceM: number | null = null;
  if (values.distance.trim() !== '') {
    displayDistanceM = parseDistanceKm(values.distance);
    if (displayDistanceM === null || displayDistanceM <= 0) errors.distance = 'invalid_distance';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, name, displayDistanceM };
}

/** Distance shown in the list: whole kilometres without decimals ("10 km", "21,10 km"). */
export function formatEventDistance(distanceM: number | null): string {
  if (distanceM === null) return '—';
  return formatDistance(distanceM, { decimals: distanceM % 1000 === 0 ? 0 : 2 });
}
