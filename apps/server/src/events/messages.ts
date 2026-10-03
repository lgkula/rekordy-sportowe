/** Error messages of the events and settings APIs (Polish, shown to the user as-is). */
export const eventMessages = {
  notFound: 'Nie znaleziono wydarzenia.',
  invalid: 'Nieprawidłowe dane wydarzenia.',
  mergeSelf: 'Nie można scalić wydarzenia z nim samym.',
  mergeSport: 'Scalać można tylko wydarzenia tego samego sportu.',
  orderInvalid: 'Lista zawiera wydarzenia, których nie ma w tym sporcie.',
  unknownSetting: 'Nieznane ustawienie.',
  invalidSetting: 'Nieprawidłowa wartość ustawienia.',
} as const;
