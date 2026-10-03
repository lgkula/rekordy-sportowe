import {
  IconFileImport,
  IconFlag,
  IconRun,
  IconSettings,
  IconTrophy,
  type Icon,
} from '@tabler/icons-react';
import { pl } from './i18n/pl';

export type NavItem = { path: string; label: string; icon: Icon; editorOnly?: boolean };

/** Main navigation, in display order. */
export const navItems: readonly NavItem[] = [
  { path: '/records', label: pl.nav.records, icon: IconTrophy },
  { path: '/races', label: pl.nav.races, icon: IconFlag },
  { path: '/activities', label: pl.nav.activities, icon: IconRun },
  { path: '/import', label: pl.nav.import, icon: IconFileImport, editorOnly: true },
  { path: '/admin', label: pl.nav.admin, icon: IconSettings, editorOnly: true },
];

export const defaultPath = '/records';

/** Items visible for the current role (editor-only sections are hidden from viewers). */
export function visibleNavItems(canEdit: boolean): readonly NavItem[] {
  return navItems.filter((item) => canEdit || !item.editorOnly);
}
