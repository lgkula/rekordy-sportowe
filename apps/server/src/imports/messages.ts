import type { FitErrorCode } from '@rekordy/core/fit';

/** Error messages of the import API (Polish, shown to the user as-is). */
export const importMessages = {
  noFile: 'Brak pliku w żądaniu.',
  invalidMeta: 'Nieprawidłowe dane do zapisu.',
  fileTooLarge: 'Plik jest za duży.',
} as const;

export const fitErrorMessages: Record<FitErrorCode, string> = {
  not_fit: 'To nie jest plik FIT.',
  corrupt: 'Plik FIT jest uszkodzony.',
  not_activity: 'Plik FIT nie zawiera aktywności.',
  no_session: 'Plik FIT nie zawiera podsumowania aktywności.',
  multisport: 'Aktywności wielodyscyplinowe nie są obsługiwane.',
  unsupported_sport: 'Ten sport nie jest obsługiwany.',
  no_distance: 'Aktywność nie ma dystansu.',
};
