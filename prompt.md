# Opis zadania

Zaplanuj stworzenie aplikacji webowej do prezentowania rekordów sportowych

- zaproponuj technologie
- zaproponuj podział implementacji na części
- przygotuj plan po angielsku z podsumowaniem dla mnie po polsku
- przygotuj prompt-y po angielsku dla każdej części oraz krótkie podsumowanie każdego promptu po polsku
- prompt powinien przywidywać, że dodatkowe pytania są zadawane po polsku
- przy tworzeniu planu i implementacji przy wątpliwościach pytaj mnie

# Głowne widoki aplikacji

## Widok z rekordami życiowymi

- oddzielnie dla sportów: biegi, biegi przełajowe, (narciarstwo biegowe w przyszłości)
- dla biegów i biegów dystansowych dystanse: 1km, 5km, 10km, półmaraton
- tolerancja do dystansu > 1 km to 10% dystansu czyli przebiegnięcie 4,6km może stworzyć rekord na 5km
  - jeśli rekord jest na niepełnym dystansie przez tolerancję to taki rekord jest oznaczony specjalnie i po najechaniu na niego pojawia się tooltip z dystansem
- przy aktywności na 10km, można zrobić rekord na 5km, jeśli w ramach 10km 5km przebiegnie się w rekordowym tempie
- pokazywane są tylko te dystanse dla których mam odnotowany rekord
- każdy rekord jest powiązany z linkiem do aktywności jeśli taki link został dostarczony przy imporcie / wprowadzeniu danych
- dla każdego dystansu są podawane 3 najlepsze wyniki w historii i to one są traktowane jako całość
  - każdy wynik to tempo i czas
- możliwość edycji / kasowania każdego wyniku w ramach rekordu

## Widok z listą zawodów sportowych

- lista wszystkich zaimportowanych zawodów sportowych, oddzielnie dla każdego ze sportów
- kolejne edycje tego samego wydarzenia są grupowane na liście głownej jako jedno wydarzenie sportowe
- na liście głownej zawodów dystans i rekordowe tempo ze wszystkich edycji tych zawodów (przy biegach przełajowych - dodatkowo przewyższenie)
- możliwość ręcznego ustawienia kolejności wydarzeń lub sortowania po nazwie
- kliknięcie na nazwę wydarzenia rozwija listę wszystkich edycji tego wydarzenia
  - przy każdej edycji informacja o:
    - dodatkowej nazwie np. jesień
    - dacie
    - tempie
  - kliknięcie na edycji wyświetla informację o tempie na poszczególnych kilometrach oraz wprowadzone notatki

## Lista aktywności sportowych

- lista zaimportowanych / dodanych ręcznie aktywności sportowych
  - możliwość edycji lub skasowania każdej aktywności
  - możliwość ustawienia trybu ukrytego aktywności, w którym wyniki z aktywności nie pojawiają się na liście rekordów
  - weryfikacja braku duplikowania tych samych aktywności
  - możliwość sortowania listy po nazwie / dystansie

# Dostęp do aplikacji

- Przeglądanie danych nie wymaga autoryzacji a jedynie wpisanie stałego hasła 'lk' (rola: viewer)
- Modyfikacja danych wymaga mocnego hasła (rola: editor)
- Możliwość przełączenia roli
- Checkbox z możliwością zapamiętania roli w przeglądarce

# Lokalizacja aplikacji

- aplikacja udostępniana na serwerze hostingowym

# Dodawanie danych do aplikacji

## Ręczne

- wprowadzanie aktywności ręcznie przez formularz
  - możliwość uproszczonego wprowadzania aktywności
    - uproszczone ograniczone do:
      - nazwy
      - dystansu
      - daty
      - rekordu na wybranym dystansie
      - linku do aktywności w Garmin Connect / Strava

## Importowanie plików FIT

- importowanie aktywności sportowych na podstawie plików fit z zegarka Garmin
  - walidacja braku ponownego importowania tej samej aktywności lub z pliku o tej samej nazwie
  - możliwość jednoczesnego importu wielu plików
  - po zaimportowaniu każdego pliku prezentacja danych do zatwierdzenia
  - odczytywanie z plików fit czy aktywność oznaczona jako zawody sportowe

## Bulk import

- import na podstawie bulk exportu ze Strava / Garmin Connect
  - weryfikacja czy dana aktywność została już wcześniej zaimportowana
  - możliwość wyboru czy każdą aktywność zatwierdzamy ręcznie, czy automatycznie

## Skrypt pobierający pliki fit

- skrypt dla systemu Windows
- skrypt po podłączeniu zegarka pobiera pliki fit i przesyła dane do aplikacji
