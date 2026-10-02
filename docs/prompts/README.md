# Prompty implementacyjne

Każdy plik to jedna sesja Claude Code. Uruchamiaj je **po kolei**. Każda część zakłada, że poprzednie są skończone.
Wklej do Claude Code całą sekcję **Prompt** z danego pliku (albo napisz: `wykonaj prompt z pliku docs/prompts/0X-....md`).

Wszystkie prompty zawierają te same zasady pracy:

- Claude najpierw czyta [PLAN.md](../PLAN.md).
- Zanim zacznie pisać kod, zadaje pytania **po polsku** i czeka na odpowiedź.
- Kod i commity pisze po angielsku, interfejs aplikacji po polsku.
- Uwzględnia hosting Seohost:
  - SSH jest dostępne i można z niego korzystać (migracje, skrypty, cron)
  - proces aplikacji Node.js (v22) uruchamia wyłącznie panel przez Passenger, z plikiem startowym `app.js`
  - kod ma działać z Passengerem: port z `process.env.PORT`, żadnych ważnych danych trzymanych tylko w pamięci procesu.
- Na końcu aktualizuje status i dziennik decyzji w PLAN.md.

| # | Plik | Podsumowanie |
|---|---|---|
| 0 | [00-scaffold-and-deploy.md](00-scaffold-and-deploy.md) | Najpierw mała aplikacja testowa na Seohost (Passenger, Node 22). Potem szkielet monorepo (React + Fastify + MySQL), CLAUDE.md, serwer w jednym pliku, wdrożenie jedną komendą (rsync + migracje + restart przez SSH), instrukcja panelu po polsku. |
| 1 | [01-auth-and-roles.md](01-auth-and-roles.md) | Logowanie hasłem (`lk` → przeglądający, silne → edytor), przełączanie ról, „zapamiętaj w przeglądarce”, token dla skryptu. |
| 2 | [02-data-model-and-activities.md](02-data-model-and-activities.md) | Pełny schemat bazy, lista aktywności (sortowanie, edycja, usuwanie, tryb ukryty), formularz pełny i uproszczony, wykrywanie duplikatów. |
| 3 | [03-fit-import.md](03-fit-import.md) | Parser FIT we wspólnym pakiecie, import wielu plików naraz z zatwierdzaniem każdego, wykrywanie zawodów i rodzaju biegu, międzyczasy. |
| 4 | [04-records.md](04-records.md) | Silnik rekordów (najszybszy odcinek, tolerancja 10%, top 3 wg tempa) i widok rekordów z tooltipami oraz edycją i usuwaniem wyników. |
| 5 | [05-races.md](05-races.md) | Widok zawodów: grupowanie edycji, najlepsze tempo, przewyższenie dla przełajów, ręczna kolejność lub sortowanie po nazwie, tempa na kilometrach i notatki. |
| 6 | [06-bulk-import.md](06-bulk-import.md) | Import eksportu zbiorczego Strava / Garmin Connect przetwarzany w przeglądarce, wykrywanie duplikatów, tryb ręczny lub automatyczny. |
| 7 | [07-windows-sync-agent.md](07-windows-sync-agent.md) | Skrypt PowerShell dla Fenix 7X (MTP): wykrywa podłączenie zegarka, pobiera nowe pliki FIT i wysyła je do skrzynki importu. |
| 8 | [08-hardening-and-release.md](08-hardening-and-release.md) | Testy E2E, kopie zapasowe bazy, obsługa błędów, dokumentacja użytkownika po polsku, wydanie końcowe. |
