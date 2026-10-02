import { pl } from './i18n/pl';

export type NavItem = { path: string; label: string };

/** Main navigation, in display order. */
export const navItems: readonly NavItem[] = [
  { path: '/records', label: pl.nav.records },
  { path: '/races', label: pl.nav.races },
  { path: '/activities', label: pl.nav.activities },
  { path: '/import', label: pl.nav.import },
];

export const defaultPath = '/records';
