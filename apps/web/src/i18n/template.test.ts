import { describe, expect, it } from 'vitest';
import { plural, t } from './template';

describe('t', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(t('Razem: {count} ({x})', { count: 3 })).toBe('Razem: 3 ({x})');
  });
});

describe('plural', () => {
  const forms = ['edycja', 'edycje', 'edycji'] as const;

  it('picks the Polish plural form', () => {
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 102, 112].map((n) => plural(n, forms))).toEqual([
      'edycji',
      'edycja',
      'edycje',
      'edycje',
      'edycji',
      'edycji',
      'edycji',
      'edycji',
      'edycji',
      'edycje',
      'edycji',
      'edycje',
      'edycji',
    ]);
  });
});
