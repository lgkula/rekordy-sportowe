import { describe, expect, it } from 'vitest';
import {
  formatDistanceInput,
  formatDurationInput,
  parseDecimal,
  parseDistanceKm,
  parseDuration,
} from './parse';

describe('parseDuration', () => {
  it('parses mm:ss', () => {
    expect(parseDuration('19:45')).toBe(1185);
    expect(parseDuration('0:59')).toBe(59);
    expect(parseDuration(' 4:05 ')).toBe(245);
  });

  it('allows minutes above 59 without hours', () => {
    expect(parseDuration('75:30')).toBe(4530);
  });

  it('parses h:mm:ss', () => {
    expect(parseDuration('1:32:10')).toBe(5530);
    expect(parseDuration('10:00:05')).toBe(36005);
  });

  it('accepts a tenth of a second with a comma or a dot', () => {
    expect(parseDuration('19:45,3')).toBeCloseTo(1185.3);
    expect(parseDuration('19:45.3')).toBeCloseTo(1185.3);
  });

  it('rejects invalid input', () => {
    for (const input of [
      '',
      '45',
      '1:60',
      '1:5',
      '1:75:00',
      'abc',
      '-1:00',
      '1:00:00:00',
      '0:00',
    ]) {
      expect(parseDuration(input), input).toBeNull();
    }
  });
});

describe('parseDecimal', () => {
  it('accepts a comma or a dot', () => {
    expect(parseDecimal('5,3')).toBe(5.3);
    expect(parseDecimal('5.3')).toBe(5.3);
    expect(parseDecimal('12')).toBe(12);
  });

  it('rejects invalid input', () => {
    for (const input of ['', '5,', ',5', '1,2,3', '-1', 'abc', '1e3']) {
      expect(parseDecimal(input), input).toBeNull();
    }
  });
});

describe('parseDistanceKm', () => {
  it('returns metres', () => {
    expect(parseDistanceKm('5,3')).toBe(5300);
    expect(parseDistanceKm('21,0975')).toBe(21097.5);
    expect(parseDistanceKm('10')).toBe(10000);
    expect(parseDistanceKm('4.6 km')).toBe(4600);
  });

  it('rounds to 0.1 m', () => {
    expect(parseDistanceKm('5,00004')).toBe(5000);
    expect(parseDistanceKm('5,00006')).toBe(5000.1);
  });

  it('rejects zero and invalid input', () => {
    expect(parseDistanceKm('0')).toBeNull();
    expect(parseDistanceKm('')).toBeNull();
    expect(parseDistanceKm('pięć')).toBeNull();
  });
});

describe('form input formatting', () => {
  it('round-trips durations', () => {
    for (const s of [1185, 59, 5530, 36005, 1185.3, 4530]) {
      expect(parseDuration(formatDurationInput(s))).toBeCloseTo(s);
    }
    expect(formatDurationInput(1185)).toBe('19:45');
    expect(formatDurationInput(5530)).toBe('1:32:10');
    expect(formatDurationInput(1185.3)).toBe('19:45,3');
  });

  it('formats distances with a comma and without trailing zeros', () => {
    expect(formatDistanceInput(21097.5)).toBe('21,0975');
    expect(formatDistanceInput(5300)).toBe('5,3');
    expect(formatDistanceInput(10000)).toBe('10');
    expect(parseDistanceKm(formatDistanceInput(4600.1))).toBe(4600.1);
  });
});
