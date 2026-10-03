import { describe, expect, it } from 'vitest';
import {
  aggregateEvent,
  compareNamesPl,
  computedEventDistanceM,
  editionPace,
  settingValueSchema,
  sortEventList,
  type EventEdition,
  type EventListItem,
} from './events';

let nextId = 0;
function edition(overrides: Partial<EventEdition>): EventEdition {
  nextId++;
  const distanceM = overrides.distanceM ?? 10000;
  const durationS = overrides.durationS === undefined ? 2700 : overrides.durationS;
  return {
    activityId: nextId,
    activityName: `Edycja ${nextId}`,
    editionLabel: null,
    localDate: '2025-05-01',
    startTimeUtc: null,
    distanceM,
    durationS,
    paceSPerKm: editionPace(distanceM, durationS),
    elevationGainM: null,
    isHidden: false,
    ...overrides,
  };
}

describe('editionPace', () => {
  it('is the pace from the totals', () => {
    expect(editionPace(10000, 2700)).toBe(270);
    expect(editionPace(5000, null)).toBeNull();
  });
});

describe('aggregateEvent', () => {
  it('takes the best pace across editions', () => {
    const slow = edition({ localDate: '2024-11-11', durationS: 2800 });
    const fast = edition({ localDate: '2025-11-11', durationS: 2650 });
    const result = aggregateEvent('road_run', [fast, slow], null);
    expect(result.bestPaceSPerKm).toBe(265);
    expect(result.bestEdition?.activityId).toBe(fast.activityId);
    expect(result.editionCount).toBe(2);
    expect(result.latestDate).toBe('2025-11-11');
    expect(result.elevationGainM).toBeNull();
  });

  it('compares paces even when the distances differ', () => {
    const shortCourse = edition({ distanceM: 9500, durationS: 2565 }); // 4:30
    const full = edition({ distanceM: 10000, durationS: 2750 }); // 4:35
    expect(aggregateEvent('road_run', [full, shortCourse], null).bestEdition?.activityId).toBe(
      shortCourse.activityId,
    );
  });

  it('prefers the earlier edition on a tie', () => {
    const older = edition({ localDate: '2023-06-01' });
    const newer = edition({ localDate: '2024-06-01' });
    expect(aggregateEvent('road_run', [newer, older], null).bestEdition?.activityId).toBe(
      older.activityId,
    );
  });

  it('takes the elevation gain of the best-pace edition for trail runs (Q6)', () => {
    const best = edition({ durationS: 3000, elevationGainM: 420 });
    const latest = edition({ durationS: 3300, elevationGainM: 510, localDate: '2026-05-01' });
    expect(aggregateEvent('trail_run', [latest, best], null).elevationGainM).toBe(420);
    expect(aggregateEvent('road_run', [latest, best], null).elevationGainM).toBeNull();
  });

  it('shows hidden editions but does not count them', () => {
    const hiddenFast = edition({ durationS: 2000, isHidden: true, distanceM: 21100 });
    const visible = edition({ durationS: 2800 });
    const result = aggregateEvent('road_run', [hiddenFast, visible], null);
    expect(result.bestEdition?.activityId).toBe(visible.activityId);
    expect(result.editionCount).toBe(2);
    expect(result.computedDistanceM).toBe(10000);
  });

  it('has no pace when every edition is hidden or without a time', () => {
    const result = aggregateEvent(
      'road_run',
      [edition({ isHidden: true }), edition({ durationS: null })],
      null,
    );
    expect(result.bestPaceSPerKm).toBeNull();
    expect(result.bestEdition).toBeNull();
  });

  it('uses the manual distance when set (Q9)', () => {
    const editions = [edition({ distanceM: 10080 }), edition({ distanceM: 10120 })];
    const result = aggregateEvent('road_run', editions, 10000);
    expect(result.distanceM).toBe(10000);
    expect(result.computedDistanceM).toBe(10100);
  });

  it('handles an event without editions', () => {
    expect(aggregateEvent('trail_run', [], null)).toEqual({
      distanceM: null,
      computedDistanceM: null,
      bestPaceSPerKm: null,
      bestEdition: null,
      elevationGainM: null,
      editionCount: 0,
      latestDate: null,
    });
  });
});

describe('computedEventDistanceM', () => {
  it('takes the most common distance, ignoring GPS noise', () => {
    const editions = [
      edition({ distanceM: 10040 }),
      edition({ distanceM: 10120 }),
      edition({ distanceM: 10080 }),
      edition({ distanceM: 8200 }),
    ];
    expect(computedEventDistanceM(editions)).toBe(10080);
  });

  it('prefers the group with the newest edition on a tie', () => {
    const editions = [
      edition({ distanceM: 21100, localDate: '2023-04-01' }),
      edition({ distanceM: 15000, localDate: '2025-04-01' }),
    ];
    expect(computedEventDistanceM(editions)).toBe(15000);
  });

  it('falls back to hidden editions when nothing else is left', () => {
    expect(computedEventDistanceM([edition({ distanceM: 5004, isHidden: true })])).toBe(5000);
  });
});

describe('sortEventList', () => {
  type Item = Pick<EventListItem, 'id' | 'activityId' | 'name' | 'sortOrder' | 'latestDate'>;
  const items: Item[] = [
    { id: 1, activityId: null, name: 'Zawody', sortOrder: 2, latestDate: '2024-01-01' },
    { id: 2, activityId: null, name: 'Łódź Maraton', sortOrder: 0, latestDate: '2023-01-01' },
    { id: null, activityId: 7, name: 'Lublin', sortOrder: null, latestDate: '2022-01-01' },
    { id: null, activityId: 8, name: 'Śnieżka', sortOrder: null, latestDate: '2025-01-01' },
    { id: 3, activityId: null, name: 'Sobótka', sortOrder: 1, latestDate: null },
  ];

  it('keeps the manual order, unassigned races last and newest first', () => {
    expect(sortEventList(items, 'manual').map((i) => i.name)).toEqual([
      'Łódź Maraton',
      'Sobótka',
      'Zawody',
      'Śnieżka',
      'Lublin',
    ]);
  });

  it('sorts by name with Polish collation', () => {
    expect(sortEventList(items, 'name').map((i) => i.name)).toEqual([
      'Lublin',
      'Łódź Maraton',
      'Sobótka',
      'Śnieżka',
      'Zawody',
    ]);
  });

  it('compares Polish letters after their base letters', () => {
    expect(compareNamesPl('Łask', 'Lwów')).toBeGreaterThan(0);
    expect(compareNamesPl('ćma', 'cyrk')).toBeGreaterThan(0);
    expect(compareNamesPl('bieg 10', 'bieg 9')).toBeGreaterThan(0);
  });
});

describe('settingValueSchema', () => {
  it('knows the event ordering of each sport', () => {
    expect(settingValueSchema('events.ordering.trail_run')?.safeParse('name').success).toBe(true);
    expect(settingValueSchema('events.ordering.trail_run')?.safeParse('date').success).toBe(false);
    expect(settingValueSchema('events.ordering.golf')).toBeNull();
    expect(settingValueSchema('other')).toBeNull();
  });
});
