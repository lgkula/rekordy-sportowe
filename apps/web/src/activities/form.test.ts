import type { ActivityDetail } from '@rekordy/core';
import { describe, expect, it } from 'vitest';
import {
  detailToFormValues,
  emptyFormValues,
  parseActivityForm,
  toPatch,
  type ActivityFormValues,
} from './form';

function values(overrides: Partial<ActivityFormValues>): ActivityFormValues {
  return { ...emptyFormValues('road_run'), name: 'Parkrun', localDate: '2026-09-12', ...overrides };
}

describe('parseActivityForm (full)', () => {
  it('parses Polish number and time formats', () => {
    const result = parseActivityForm(
      values({
        distance: '5,02',
        duration: '20:05',
        elapsed: '20:30',
        elevationGain: '35',
        startTime: '09:00',
        notes: '  ',
        splits: [{ distance: '1', duration: '4:01', elevationGain: '' }],
      }),
      'full',
    );
    expect(result).toEqual({
      ok: true,
      input: expect.objectContaining({
        mode: 'full',
        distanceM: 5020,
        durationS: 1205,
        elapsedS: 1230,
        elevationGainM: 35,
        startTimeUtc: new Date('2026-09-12T09:00:00').toISOString(),
        notes: null,
        activityUrl: null,
        splits: [{ km: 1, distanceM: 1000, durationS: 241, elevationGainM: null }],
      }),
    });
  });

  it('reports field errors with validation codes', () => {
    const result = parseActivityForm(
      values({
        name: '',
        localDate: '',
        distance: '5km5',
        duration: '',
        elevationGain: '1,5',
        activityUrl: 'strava',
        splits: [{ distance: '1', duration: 'x', elevationGain: '' }],
      }),
      'full',
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'required',
        localDate: 'required',
        distance: 'invalid_distance',
        duration: 'required',
        elevationGain: 'invalid_elevation',
        activityUrl: 'invalid_url',
        'splits.0.duration': 'invalid_duration',
      },
    });
  });

  it('checks cross-field rules', () => {
    const result = parseActivityForm(
      values({ distance: '5', duration: '20:00', elapsed: '19:00' }),
      'full',
    );
    expect(result).toEqual({ ok: false, errors: { elapsed: 'elapsed_lt_duration' } });
  });
});

describe('parseActivityForm (simplified)', () => {
  it('builds the manual result and ignores full-form fields', () => {
    const result = parseActivityForm(
      values({
        distance: '10,2',
        effortKey: '5k',
        effortDuration: '21:30',
        duration: '',
        isRace: true,
        notes: 'pominięte',
      }),
      'simple',
    );
    expect(result).toEqual({
      ok: true,
      input: {
        mode: 'simple',
        sport: 'road_run',
        name: 'Parkrun',
        localDate: '2026-09-12',
        distanceM: 10200,
        durationS: null,
        activityUrl: null,
        manualEffort: { distanceKey: '5k', durationS: 1290 },
      },
    });
  });

  it('requires a distance key and time, and an activity long enough', () => {
    expect(parseActivityForm(values({ distance: '10' }), 'simple')).toEqual({
      ok: false,
      errors: { effortKey: 'invalid_distance_key', effortDuration: 'required' },
    });
    expect(
      parseActivityForm(
        values({ distance: '4,4', effortKey: '5k', effortDuration: '20:00' }),
        'simple',
      ),
    ).toEqual({ ok: false, errors: { effortKey: 'effort_distance_too_short' } });
  });
});

describe('editing', () => {
  const detail: ActivityDetail = {
    id: 7,
    sport: 'trail_run',
    name: 'Las',
    localDate: '2026-09-13',
    startTimeUtc: null,
    distanceM: 10200,
    durationS: null,
    paceSPerKm: null,
    isRace: false,
    isHidden: true,
    source: 'manual_simple',
    activityUrl: null,
    elapsedS: null,
    elevationGainM: null,
    eventId: null,
    editionLabel: null,
    notes: null,
    externalId: null,
    fileName: null,
    splits: null,
    hasStream: false,
    createdAt: '2026-09-13T10:00:00.000Z',
    updatedAt: '2026-09-13T10:00:00.000Z',
    efforts: [
      {
        id: 1,
        activityId: 7,
        sport: 'trail_run',
        distanceKey: '5k',
        targetM: 5000,
        actualDistanceM: 5000,
        durationS: 1500,
        paceSPerKm: 300,
        isTolerance: false,
        origin: 'manual',
        isEdited: false,
        isDeleted: false,
      },
    ],
  };

  it('fills the form from an activity, including the manual result', () => {
    expect(detailToFormValues(detail)).toMatchObject({
      sport: 'trail_run',
      distance: '10,2',
      duration: '',
      isHidden: true,
      effortKey: '5k',
      effortDuration: '25:00',
    });
  });

  it('round-trips through the simplified form into a PATCH', () => {
    const result = parseActivityForm(detailToFormValues(detail), 'simple');
    expect(result.ok && toPatch(result.input)).toEqual({
      sport: 'trail_run',
      name: 'Las',
      localDate: '2026-09-13',
      distanceM: 10200,
      durationS: null,
      activityUrl: null,
      manualEffort: { distanceKey: '5k', durationS: 1500 },
    });
  });

  it('sends every field from the full form, clearing empty ones', () => {
    const result = parseActivityForm({ ...detailToFormValues(detail), duration: '55:00' }, 'full');
    expect(result.ok && toPatch(result.input)).toEqual({
      sport: 'trail_run',
      name: 'Las',
      localDate: '2026-09-13',
      startTimeUtc: null,
      distanceM: 10200,
      durationS: 3300,
      elapsedS: null,
      elevationGainM: null,
      isRace: false,
      isHidden: true,
      editionLabel: null,
      notes: null,
      activityUrl: null,
      splits: null,
    });
  });
});
