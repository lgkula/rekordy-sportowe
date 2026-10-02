import { describe, expect, it } from 'vitest';
import { addDays, isSimilarActivity } from './duplicates';

const base = {
  localDate: '2026-09-12',
  startTimeUtc: '2026-09-12T07:00:00.000Z',
  distanceM: 10000,
};

describe('isSimilarActivity', () => {
  it('matches a start within ±2 min and a distance within ±3%', () => {
    expect(isSimilarActivity(base, { ...base })).toBe(true);
    expect(
      isSimilarActivity(base, {
        ...base,
        startTimeUtc: '2026-09-12T07:02:00.000Z',
        distanceM: 10300,
      }),
    ).toBe(true);
    expect(
      isSimilarActivity(base, {
        ...base,
        startTimeUtc: '2026-09-12T06:58:00.000Z',
        distanceM: 9700,
      }),
    ).toBe(true);
  });

  it('does not match outside the limits', () => {
    expect(isSimilarActivity(base, { ...base, startTimeUtc: '2026-09-12T07:02:01.000Z' })).toBe(
      false,
    );
    expect(isSimilarActivity(base, { ...base, distanceM: 10301 })).toBe(false);
    expect(isSimilarActivity(base, { ...base, distanceM: 9699 })).toBe(false);
  });

  it('falls back to the same local date when a start time is missing', () => {
    expect(isSimilarActivity({ ...base, startTimeUtc: null }, base)).toBe(true);
    expect(isSimilarActivity(base, { ...base, startTimeUtc: null })).toBe(true);
    expect(isSimilarActivity(base, { ...base, startTimeUtc: null, localDate: '2026-09-13' })).toBe(
      false,
    );
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
