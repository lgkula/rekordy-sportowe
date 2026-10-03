import type { RecordEntry } from '@rekordy/core';
import { describe, expect, it } from 'vitest';
import { buildEffortPatch, effortFormValues, effortPreview, entryDurationS } from './effortForm';

const full: RecordEntry = {
  effortId: 1,
  activityId: 10,
  activityName: 'Parkrun',
  localDate: '2026-09-12',
  activityUrl: null,
  paceSPerKm: 240,
  durationS: 1200,
  actualDistanceM: 5000,
  isTolerance: false,
  origin: 'computed',
  isEdited: false,
};

const tolerance: RecordEntry = {
  ...full,
  effortId: 2,
  paceSPerKm: 230,
  durationS: null,
  actualDistanceM: 4600,
  isTolerance: true,
  activityUrl: 'https://www.strava.com/activities/1',
};

describe('effort edit form', () => {
  it('starts from the stored values, the time of a tolerance result from its pace', () => {
    expect(effortFormValues(full)).toEqual({ duration: '20:00', distance: '5', activityUrl: '' });
    expect(entryDurationS(tolerance)).toBe(1058);
    expect(effortFormValues(tolerance)).toEqual({
      duration: '17:38',
      distance: '4,6',
      activityUrl: 'https://www.strava.com/activities/1',
    });
  });

  it('sends nothing when nothing changed (also when only the formatting did)', () => {
    const initial = effortFormValues(full);
    expect(buildEffortPatch('5k', initial, initial)).toEqual({ ok: true, patch: null });
    expect(buildEffortPatch('5k', { ...initial, distance: '5,0 km' }, initial)).toEqual({
      ok: true,
      patch: null,
    });
  });

  it('sends the time and the distance together', () => {
    const initial = effortFormValues(full);
    expect(buildEffortPatch('5k', { ...initial, duration: '19:30' }, initial)).toEqual({
      ok: true,
      patch: { durationS: 1170, actualDistanceM: 5000 },
    });
  });

  it('sends the link alone, and an empty link as null', () => {
    const initial = effortFormValues(tolerance);
    const url = 'https://connect.garmin.com/app/activity/5';
    expect(buildEffortPatch('5k', { ...initial, activityUrl: ` ${url} ` }, initial)).toEqual({
      ok: true,
      patch: { activityUrl: url },
    });
    expect(buildEffortPatch('5k', { ...initial, activityUrl: '' }, initial)).toEqual({
      ok: true,
      patch: { activityUrl: null },
    });
  });

  it('reports invalid input and distances outside the target range', () => {
    const initial = effortFormValues(full);
    expect(
      buildEffortPatch('5k', { duration: 'abc', distance: 'x', activityUrl: 'ftp://a' }, initial),
    ).toEqual({
      ok: false,
      errors: {
        duration: 'invalid_duration',
        distance: 'invalid_distance',
        activityUrl: 'invalid_url',
      },
    });
    expect(buildEffortPatch('5k', { ...initial, distance: '4,4' }, initial)).toEqual({
      ok: false,
      errors: { distance: 'effort_distance_out_of_range' },
    });
    expect(buildEffortPatch('1k', { ...initial, distance: '0,95' }, initial)).toMatchObject({
      ok: false,
    });
  });

  it('previews the pace and the tolerance', () => {
    expect(
      effortPreview('5k', { duration: '19:00', distance: '4,75', activityUrl: '' }),
    ).toMatchObject({ paceSPerKm: 240, isTolerance: true });
    expect(effortPreview('5k', { duration: '', distance: '5', activityUrl: '' })).toBeNull();
  });
});
