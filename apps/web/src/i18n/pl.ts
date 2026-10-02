/** All user-facing UI strings (Polish). Keep text out of components so i18n can be added later. */
export const pl = {
  appName: 'Rekordy sportowe',
  nav: {
    records: 'Rekordy',
    races: 'Zawody',
    activities: 'Aktywności',
    import: 'Import',
    toggle: 'Przełącz nawigację',
  },
  pages: {
    records: { title: 'Rekordy życiowe' },
    races: { title: 'Zawody' },
    activities: { title: 'Aktywności' },
    import: { title: 'Import' },
    notFound: {
      title: 'Nie znaleziono strony',
      back: 'Wróć do rekordów',
    },
  },
  placeholder: 'Ta sekcja jest w przygotowaniu.',
  apiStatus: {
    checking: 'Sprawdzanie serwera…',
    ok: 'Serwer: OK',
    degraded: 'Serwer: problem',
    offline: 'Serwer: brak połączenia',
  },
} as const;
