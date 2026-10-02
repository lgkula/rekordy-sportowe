# Wdrożenie na Seohost — instrukcja krok po kroku

Aplikacja działa pod adresem **https://sport.kula.opole.pl**. Jej pliki są w katalogu `~/nodejsapp/rekordy-sportowe` na serwerze.

Zasada: **proces Node.js uruchamia i restartuje wyłącznie panel** (moduł Node.js w DirectAdmin, CloudLinux / Passenger). Przez SSH robimy wszystko inne: wgrywanie plików, migracje bazy i zadania serwisowe.

Szczegóły techniczne są w [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Pierwsza konfiguracja (jednorazowo)

### 1. Klucz SSH

To jest już zrobione: alias `seohost` w `C:\Users\Leszek\.ssh\config`. Sprawdzenie:

```powershell
ssh seohost "echo ok"
```

### 2. Baza danych

W panelu DirectAdmin otwórz **Bazy danych MySQL → Utwórz bazę**:

- nazwa bazy, np. `srv34629_rekordy`
- użytkownik, np. `srv34629_rekordy`
- **silne hasło**: zapisz je, trafi do pliku `.env`.

Na Seohost działa **MariaDB 11.4**.

### 3. Aplikacja Node.js w panelu

W panelu otwórz **Node.js → Utwórz aplikację** i ustaw:

| Pole | Wartość |
|---|---|
| Wersja Node.js | **22.23.2** (domyślnie jest 10.24.1, trzeba zmienić) |
| Tryb aplikacji | **Production** |
| Katalog główny aplikacji | `nodejsapp/rekordy-sportowe` |
| URL aplikacji | `sport.kula.opole.pl` (pole ścieżki **puste**) |
| Plik startowy aplikacji | `app.js` |
| Environment variables | nic (konfiguracja jest w `.env`) |

Kliknij **CREATE**, a potem uruchom aplikację (Start/Restart).

> Panel tworzy `public_html/.htaccess` subdomeny, ale zostawia tam domyślny `index.html` Seohost, który zasłania aplikację na `/`. Trzeba go przemianować (już zrobione):
> `ssh seohost "mv ~/domains/sport.kula.opole.pl/public_html/index.html ~/domains/sport.kula.opole.pl/public_html/index.html.seohost-default"`
>
> Podczas części 0 w tym katalogu jest najpierw aplikacja testowa (`spikes/passenger-hello`). Po wejściu na https://sport.kula.opole.pl pokazuje JSON z wersją Node, katalogiem roboczym i zmiennymi środowiskowymi (same nazwy, bez wartości). Pierwsze `npm run deploy` zastępuje ją właściwą aplikacją.

### 4. Plik `.env` na serwerze

Hasło do bazy nie trafia ani do repozytorium, ani do czatu. Plik tworzysz sam:

```powershell
ssh seohost
```

```bash
cd ~/nodejsapp/rekordy-sportowe
cat > .env <<'EOF'
LOG_LEVEL=info
DB_HOST=localhost
DB_PORT=3306
DB_USER=srv34629_rekordy
DB_PASSWORD='TU_WPISZ_HASLO'
DB_NAME=srv34629_rekordy
EOF
chmod 600 .env
nano .env    # wpisz prawdziwe hasło; zapis: Ctrl+O, Enter; wyjście: Ctrl+X
exit
```

`NODE_ENV=production` ustawia panel (pole „Tryb aplikacji”), więc nie trzeba go wpisywać.

> **Hasło zawsze w pojedynczych cudzysłowach** (`'...'`). Bez nich znak `#` rozpoczyna komentarz i hasło zostaje obcięte, a aplikacja zgłasza „Access denied”. Jeśli hasło zawiera `'`, użyj podwójnych cudzysłowów.

### 5. Pierwsze wdrożenie

Na swoim komputerze, w katalogu projektu:

```powershell
npm run deploy
```

Skrypt:

1. buduje aplikację
2. pakuje ją do `deploy/rekordy-sportowe.tar.gz`
3. wysyła paczkę przez `scp`
4. przez SSH rozpakowuje ją, nie ruszając `.env` ani `storage/`
5. wykonuje migracje bazy
6. restartuje aplikację przez moduł Node.js panelu (`cloudlinux-selector restart`)
7. czeka, aż https://sport.kula.opole.pl/api/health zwróci `"status":"ok"`.

---

## Każda kolejna aktualizacja

```powershell
npm run deploy
```

Możesz też wdrożyć z GitHuba: **Actions → Deploy → Run workflow** (konfiguracja niżej).

## Restart aplikacji

- w panelu: **Node.js → aplikacje → Restart**, albo
- przez SSH (to ten sam mechanizm panelu):
  `ssh seohost "cloudlinux-selector restart --json --interpreter nodejs --app-root nodejsapp/rekordy-sportowe"`

Po zmianie `.env` zawsze trzeba zrestartować aplikację.

## Sprawdzenie stanu

Otwórz https://sport.kula.opole.pl/api/health:

- `"status":"ok"`: wszystko działa
- `db.ok: false`: zły wpis w `.env` albo baza jest niedostępna
- `migrations.pending` nie jest puste: uruchom ponownie `npm run deploy` albo
  `ssh seohost "cd ~/nodejsapp/rekordy-sportowe && /opt/alt/alt-nodejs22/root/usr/bin/node dist/tools.cjs migrate"`
- `storage.writable: false`: brak uprawnień do katalogu `storage/`.

## Wdrażanie z GitHub Actions (opcjonalne)

Workflow **Deploy** uruchamiasz ręcznie. Używa **osobnego klucza** (nie Twojego prywatnego).

1. Na swoim komputerze wygeneruj klucz bez hasła:
   ```powershell
   ssh-keygen -t ed25519 -C "github-actions-rekordy" -N '""' -f $env:USERPROFILE\.ssh\rekordy_github_deploy
   ```
2. Dodaj klucz publiczny na serwerze:
   ```powershell
   type $env:USERPROFILE\.ssh\rekordy_github_deploy.pub | ssh seohost "cat >> ~/.ssh/authorized_keys"
   ```
3. Pobierz odcisk serwera (HOST i PORT weź z `C:\Users\Leszek\.ssh\config`):
   ```powershell
   ssh-keyscan -p PORT HOST
   ```
4. W repozytorium na GitHubie otwórz **Settings → Secrets and variables → Actions → New repository secret** i dodaj:

   | Sekret | Wartość |
   |---|---|
   | `SSH_HOST` | HostName z `~/.ssh/config` |
   | `SSH_PORT` | Port z `~/.ssh/config` |
   | `SSH_USER` | User z `~/.ssh/config` |
   | `SSH_PRIVATE_KEY` | cała zawartość pliku `rekordy_github_deploy` (bez `.pub`) |
   | `SSH_KNOWN_HOSTS` | wynik kroku 3 |

5. Opcjonalnie: **Settings → Environments → production**, gdzie możesz włączyć ręczne zatwierdzanie każdego wdrożenia.

## Logi

LiteSpeed zapisuje błędy i logi aplikacji w pliku `~/nodejsapp/rekordy-sportowe/stderr.log`:

```powershell
ssh seohost "tail -50 ~/nodejsapp/rekordy-sportowe/stderr.log"
```

## Znane pułapki hostingu

- **Strona domyślna Seohost zamiast aplikacji.** Pliki z `~/domains/sport.kula.opole.pl/public_html` mają pierwszeństwo przed aplikacją. Domyślny `index.html` jest już przemianowany na `index.html.seohost-default`. Nie wgrywaj tam niczego.
- **Błąd 429 „Too Many Requests” przy `curl`.** Ochrona serwera blokuje domyślnego klienta `curl`. Przy testach z konsoli dodaj własny User-Agent, np. `curl -A "test" https://sport.kula.opole.pl/api/health`.
- **„Uruchom NPM Install” w panelu nie jest potrzebne.** Aplikacja ma wszystkie biblioteki w `dist/server.cjs`. Kliknięcie nie szkodzi, ale nic nie daje.
