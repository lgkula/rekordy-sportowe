import { describe, expect, it } from 'vitest';
import {
  eventNameSimilarity,
  eventNameTokens,
  foldText,
  sameEventName,
  suggestEvents,
  tokenSimilarity,
} from './eventNames';

describe('foldText', () => {
  it('folds Polish letters and case', () => {
    expect(foldText('Zażółć GĘŚLĄ jaźń')).toBe('zazolc gesla jazn');
    expect(foldText('Łódź')).toBe('lodz');
  });
});

describe('eventNameTokens', () => {
  it('drops Polish diacritics and case', () => {
    expect(eventNameTokens('Bieg Niepodległości')).toEqual(['niepodleglosci']);
    expect(eventNameTokens('ŚLĘŻA Półmaraton')).toEqual(['sleza', 'polmaraton']);
  });

  it('drops years, dates and bare numbers', () => {
    expect(eventNameTokens('Bieg Niepodległości 2024')).toEqual(['niepodleglosci']);
    expect(eventNameTokens('Bieg zawody 27.09.2026')).toEqual(['bieg', 'zawody']);
    expect(eventNameTokens('Parkrun 2026-05-01')).toEqual(['parkrun']);
  });

  it('drops Roman numerals and ordinals', () => {
    expect(eventNameTokens('XV Bieg Niepodległości')).toEqual(['niepodleglosci']);
    expect(eventNameTokens('III Półmaraton Opolski')).toEqual(['polmaraton', 'opolski']);
    expect(eventNameTokens('xii bieg sylwestrowy')).toEqual(['sylwestrowy']);
    expect(eventNameTokens('15. Bieg Sylwestrowy')).toEqual(['sylwestrowy']);
    expect(eventNameTokens('15-ty Bieg Sylwestrowy')).toEqual(['sylwestrowy']);
  });

  it('keeps words that only look like Roman numerals in lowercase', () => {
    expect(eventNameTokens('Bieg Mix')).toEqual(['mix']);
    expect(eventNameTokens('Cross Dziki')).toEqual(['cross', 'dziki']);
  });

  it('drops edition and filler words', () => {
    expect(eventNameTokens('Bieg Kraski, 10. edycja')).toEqual(['kraski']);
    expect(eventNameTokens('Jubileuszowa edycja Biegu na Ślężę')).toEqual(['sleze']);
  });

  it('keeps distances as one token', () => {
    expect(eventNameTokens('Bieg Niepodległości 10 km')).toEqual(['niepodleglosci', '10km']);
    expect(eventNameTokens('Grand Prix 21,1km')).toEqual(['grand', 'prix', '21.1km']);
  });

  it('keeps generic words when nothing else is left', () => {
    expect(eventNameTokens('Bieg')).toEqual(['bieg']);
    expect(eventNameTokens('2024')).toEqual([]);
  });
});

describe('tokenSimilarity', () => {
  it('matches inflected forms by their stem', () => {
    expect(tokenSimilarity('opolski', 'opolska')).toBeGreaterThan(0.8);
    expect(tokenSimilarity('niepodleglosci', 'niepodlegla')).toBeGreaterThanOrEqual(0.7);
    expect(tokenSimilarity('sylwestrowy', 'sylwestrowego')).toBeGreaterThanOrEqual(0.7);
  });

  it('tolerates a typo', () => {
    expect(tokenSimilarity('niepodleglosci', 'niepodlegosci')).toBeGreaterThan(0.9);
  });

  it('does not match different words', () => {
    expect(tokenSimilarity('maraton', 'polmaraton')).toBe(0);
    expect(tokenSimilarity('opole', 'olesno')).toBe(0);
  });
});

describe('eventNameSimilarity', () => {
  it('matches editions of the same race', () => {
    expect(eventNameSimilarity('XV Bieg Niepodległości 2024', 'Bieg Niepodleglosci')).toBe(1);
    expect(eventNameSimilarity('Półmaraton Opolski', 'III Opolski Półmaraton 2023')).toBe(1);
  });

  it('scores partial matches lower', () => {
    const score = eventNameSimilarity('Maraton Warszawski', 'Półmaraton Warszawski');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.6);
  });

  it('is 0 for unrelated or empty names', () => {
    expect(eventNameSimilarity('Bieg Niepodległości', 'Bieg Sylwestrowy')).toBe(0);
    expect(eventNameSimilarity('2024', 'Bieg Sylwestrowy')).toBe(0);
  });
});

describe('suggestEvents', () => {
  const events = [
    { id: 1, name: 'Bieg Niepodległości' },
    { id: 2, name: 'Bieg Sylwestrowy' },
    { id: 3, name: 'Półmaraton Opolski' },
    { id: 4, name: 'Bieg Niepodległości 5 km' },
  ];

  it('returns similar events, best first', () => {
    expect(suggestEvents('XV Bieg Niepodleglosci 2025', events).map((s) => s.id)).toEqual([1, 4]);
    expect(suggestEvents('Opolski półmaraton', events)).toEqual([
      { id: 3, name: 'Półmaraton Opolski', score: 1 },
    ]);
  });

  it('returns nothing for a default watch name', () => {
    expect(suggestEvents('Bieg zawody 27.09.2026', events)).toEqual([]);
  });
});

describe('sameEventName', () => {
  it('ignores case, diacritics and spacing', () => {
    expect(sameEventName(' Bieg  Niepodległości', 'bieg niepodleglosci')).toBe(true);
    expect(sameEventName('Bieg Niepodległości', 'Bieg Niepodległości 2024')).toBe(false);
  });
});
