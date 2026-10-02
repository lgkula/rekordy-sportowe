import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, formatPace, paceSecondsPerKm } from './format';

describe('paceSecondsPerKm', () => {
  it('computes seconds per kilometre', () => {
    expect(paceSecondsPerKm(1200, 5000)).toBe(240);
    expect(paceSecondsPerKm(276, 1000)).toBe(276);
  });

  it('rejects zero distance and negative duration', () => {
    expect(() => paceSecondsPerKm(100, 0)).toThrow(RangeError);
    expect(() => paceSecondsPerKm(-1, 1000)).toThrow(RangeError);
  });
});

describe('formatPace', () => {
  it('formats as m:ss', () => {
    expect(formatPace(275)).toBe('4:35');
    expect(formatPace(240)).toBe('4:00');
    expect(formatPace(605)).toBe('10:05');
  });

  it('rounds to the nearest second, carrying into minutes', () => {
    expect(formatPace(299.6)).toBe('5:00');
    expect(formatPace(299.4)).toBe('4:59');
  });

  it('adds the unit on request', () => {
    expect(formatPace(275, { unit: true })).toBe('4:35 /km');
  });

  it('returns a placeholder for invalid input', () => {
    expect(formatPace(Number.NaN)).toBe('—');
    expect(formatPace(-5)).toBe('—');
    expect(formatPace(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats durations below one hour as m:ss', () => {
    expect(formatDuration(1185)).toBe('19:45');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('formats durations from one hour as h:mm:ss', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(5530)).toBe('1:32:10');
    expect(formatDuration(36005)).toBe('10:00:05');
  });

  it('rounds to the nearest second', () => {
    expect(formatDuration(3599.6)).toBe('1:00:00');
  });

  it('returns a placeholder for invalid input', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatDistance', () => {
  it('uses a Polish decimal comma and km unit', () => {
    expect(formatDistance(21097.5)).toBe('21,10 km');
    expect(formatDistance(4600)).toBe('4,60 km');
    expect(formatDistance(1000)).toBe('1,00 km');
  });

  it('supports custom decimals and no unit', () => {
    expect(formatDistance(21097.5, { decimals: 1 })).toBe('21,1 km');
    expect(formatDistance(10000, { decimals: 0, unit: false })).toBe('10');
  });

  it('does not group thousands', () => {
    expect(formatDistance(12_345_000, { decimals: 0 })).toBe('12345 km');
  });

  it('returns a placeholder for invalid input', () => {
    expect(formatDistance(-1)).toBe('—');
  });
});
