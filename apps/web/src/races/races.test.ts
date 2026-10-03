import type { EventListItem } from '@rekordy/core';
import { describe, expect, it } from 'vitest';
import {
  bestEditionLabel,
  eventFormValues,
  formatEventDistance,
  parseEventForm,
  readSport,
  reorderIds,
} from './races';

describe('readSport', () => {
  it('falls back to the first enabled sport', () => {
    expect(readSport(new URLSearchParams('sport=trail_run'))).toBe('trail_run');
    expect(readSport(new URLSearchParams('sport=xc_ski'))).toBe('road_run');
    expect(readSport(new URLSearchParams())).toBe('road_run');
  });
});

describe('reorderIds', () => {
  it('moves an event to the place of another', () => {
    expect(reorderIds([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    expect(reorderIds([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
    expect(reorderIds([1, 2], 1, 1)).toEqual([1, 2]);
    expect(reorderIds([1, 2], 1, 9)).toEqual([1, 2]);
  });
});

describe('event form', () => {
  const item = { name: 'Bieg', displayDistanceM: 10000 } as EventListItem;

  it('fills the form from an event', () => {
    expect(eventFormValues(item)).toEqual({ name: 'Bieg', distance: '10' });
    expect(eventFormValues(null, 'Zawody 1')).toEqual({ name: 'Zawody 1', distance: '' });
  });

  it('parses the name and an optional distance in Polish format', () => {
    expect(parseEventForm({ name: ' Bieg ', distance: '21,0975' })).toEqual({
      ok: true,
      name: 'Bieg',
      displayDistanceM: 21097.5,
    });
    expect(parseEventForm({ name: 'Bieg', distance: ' ' })).toEqual({
      ok: true,
      name: 'Bieg',
      displayDistanceM: null,
    });
    expect(parseEventForm({ name: '', distance: 'x' })).toEqual({
      ok: false,
      errors: { name: 'required', distance: 'invalid_distance' },
    });
  });
});

describe('formatting', () => {
  it('shows whole kilometres without decimals', () => {
    expect(formatEventDistance(10000)).toBe('10 km');
    expect(formatEventDistance(21097.5)).toBe('21,10 km');
    expect(formatEventDistance(null)).toBe('—');
  });

  it('labels the best edition by its name or date', () => {
    const best = { editionLabel: null, localDate: '2025-11-11' };
    expect(bestEditionLabel({ bestEdition: best } as EventListItem)).toBe('11.11.2025');
    expect(
      bestEditionLabel({ bestEdition: { ...best, editionLabel: 'jesień' } } as EventListItem),
    ).toBe('jesień');
    expect(bestEditionLabel({ bestEdition: null } as EventListItem)).toBeNull();
  });
});
