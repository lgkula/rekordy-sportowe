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
  editorOnly: 'Ta sekcja jest dostępna tylko w trybie edycji.',
  auth: {
    roles: { viewer: 'Przeglądanie', editor: 'Edycja' },
    login: {
      title: 'Logowanie',
      password: 'Hasło',
      remember: 'Zapamiętaj w tej przeglądarce',
      submit: 'Zaloguj',
      passwordRequired: 'Wpisz hasło.',
    },
    menu: {
      label: 'Rola i wylogowanie',
      switchToEditor: 'Przełącz na edycję',
      switchToViewer: 'Przełącz na przeglądanie',
      logout: 'Wyloguj',
    },
    switchModal: {
      title: 'Przejście do trybu edycji',
      password: 'Hasło edytora',
      submit: 'Przełącz',
      cancel: 'Anuluj',
    },
    errors: {
      invalidPassword: 'Nieprawidłowe hasło.',
      tooManyAttempts: 'Zbyt wiele nieudanych prób. Spróbuj ponownie za kilkanaście minut.',
      notConfigured: 'Logowanie nie jest jeszcze skonfigurowane na serwerze.',
      network: 'Brak połączenia z serwerem.',
      generic: 'Coś poszło nie tak. Spróbuj ponownie.',
    },
    sessionCheckFailed: 'Nie udało się sprawdzić sesji.',
    retry: 'Spróbuj ponownie',
  },
  apiStatus: {
    checking: 'Sprawdzanie serwera…',
    ok: 'Serwer: OK',
    degraded: 'Serwer: problem',
    offline: 'Serwer: brak połączenia',
  },
} as const;
