/** Polish error messages returned by the API as `{ error }`. Deliberately generic. */
export const authMessages = {
  unauthorized: 'Wymagane logowanie.',
  forbidden: 'Brak uprawnień do tej operacji.',
  invalidPassword: 'Nieprawidłowe hasło.',
  invalidToken: 'Nieprawidłowy token.',
  tooManyAttempts: 'Zbyt wiele nieudanych prób. Spróbuj ponownie później.',
  notConfigured: 'Logowanie nie jest skonfigurowane na serwerze.',
} as const;
