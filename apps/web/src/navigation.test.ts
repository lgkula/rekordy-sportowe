import { describe, expect, it } from 'vitest';
import { defaultPath, navItems, visibleNavItems } from './navigation';

describe('navigation', () => {
  it('has unique paths and Polish labels', () => {
    const paths = navItems.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(navItems.map((item) => item.label)).toEqual([
      'Rekordy',
      'Zawody',
      'Aktywności',
      'Import',
      'Administracja',
    ]);
  });

  it('defaults to the records page', () => {
    expect(navItems.some((item) => item.path === defaultPath)).toBe(true);
  });

  it('hides editor-only sections from viewers', () => {
    expect(visibleNavItems(true)).toEqual(navItems);
    expect(visibleNavItems(false).map((item) => item.path)).toEqual([
      '/records',
      '/races',
      '/activities',
    ]);
  });
});
