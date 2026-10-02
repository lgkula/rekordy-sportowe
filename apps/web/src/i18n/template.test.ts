import { describe, expect, it } from 'vitest';
import { t } from './template';

describe('t', () => {
  it('fills placeholders and leaves unknown ones', () => {
    expect(t('Razem: {count} ({x})', { count: 3 })).toBe('Razem: 3 ({x})');
  });
});
