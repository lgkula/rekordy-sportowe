import { pl } from './i18n/pl';

export type NavItem = { path: string; label: string; editorOnly?: boolean };

/** Main navigation, in display order. */
export const navItems: readonly NavItem[] = [
  { path: '/records', label: pl.nav.records },
  { path: '/races', label: pl.nav.races },
  { path: '/activities', label: pl.nav.activities },
  { path: '/import', label: pl.nav.import, editorOnly: true },
];

export const defaultPath = '/records';

/** Items visible for the current role (editor-only sections are hidden from viewers). */
export function visibleNavItems(canEdit: boolean): readonly NavItem[] {
  return navItems.filter((item) => canEdit || !item.editorOnly);
}
