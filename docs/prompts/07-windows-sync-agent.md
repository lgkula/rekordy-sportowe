# Part 7 — Windows sync agent (Fenix 7X via MTP)

## Podsumowanie (PL)

- Skrypt PowerShell dla Windows 10, niewymagający instalowania dodatkowych programów:
  - uruchamia się przy logowaniu
  - czeka na podłączenie zegarka Fenix 7X (tryb MTP, bez litery dysku)
  - kopiuje nowe pliki FIT z `GARMIN\Activity`
  - wysyła je do aplikacji z tokenem.
- Wysłane pliki trafiają do **skrzynki importu** w aplikacji (Import → Skrzynka), gdzie je zatwierdzasz. Opcjonalnie mogą być zatwierdzane automatycznie.
- W zestawie instalator (zadanie w Harmonogramie zadań), zaszyfrowany token (DPAPI), logi, powiadomienie i instrukcja po polsku.
- Zapyta, czy pliki zatwierdzać ręcznie (Q5) oraz o kilka szczegółów działania.

## Prompt

```
You are implementing Part 7 of the "rekordy-sportowe" project: the agent upload endpoint + import inbox, and the Windows sync script for a Garmin Fenix 7X Sapphire Solar (firmware 27.18) connected over MTP.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.5, 6.4, 7) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings, the script's user-facing messages and the script README are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- Q5: should uploaded files wait in the inbox for manual approval, or be approved automatically (non-duplicates)? Should this be a setting?
- How far back to sync on first run (all files on the watch, or only files newer than date X)?
- Is Garmin Express installed and running (it may hold the device)? Do I want a toast notification after upload?
- Ask me to run a small diagnostic script (which you provide) that lists the MTP device name and folder structure as seen by `Shell.Application`, so the device/folder names are verified and not guessed (e.g. "fenix 7X Sapphire Solar" → "Internal Storage" → "GARMIN" → "Activity").

## Scope
1. Server:
   - `POST /api/agent/fit` (bearer agent token, multipart, one or more files): parse with packages/core, check duplicates (a duplicate → 200 with status "duplicate", so the script can mark it as done), and create `import_items` with source `agent` in the inbox, or save directly when auto-approve is on
   - rate limit + max file size
   - `GET /api/import/inbox`, `POST /api/import/inbox/:id/approve|reject` (editor).
2. Frontend **Import → Skrzynka**:
   - a list of pending items with a badge count in the navigation
   - the same review component as FIT import (edit name, sport, race flag, event, URL, then approve/reject)
   - bulk approve
   - an auto-approve setting toggle if agreed.
3. `tools/windows-sync/` (PowerShell 5.1 compatible, no external modules):
   - `Sync-GarminFit.ps1`:
     - long-running watcher started at logon (hidden window)
     - waits for device arrival via `Register-CimIndicationEvent` on `Win32_DeviceChangeEvent` (EventType 2), with a polling fallback every 30 s and a debounce
     - finds the MTP device through `Shell.Application` → Namespace(17) (This PC) by a name pattern from config
     - navigates to `Internal Storage\GARMIN\Activity`
     - copies new `*.fit` files (not listed in `state.json`) to `%LOCALAPPDATA%\RekordySync\staging` with `CopyHere` and waits for the copy to finish (poll until the file exists and its size is stable, with a timeout)
     - uploads each file with `curl.exe -F` and the bearer token, ALWAYS with a custom User-Agent (`-A "RekordySync/<version>"`; the host's bot protection answers 429 to curl's default UA, see the PLAN.md decision log), then records the result in `state.json`
     - retries on network errors with backoff
     - writes a log to `%LOCALAPPDATA%\RekordySync\sync.log` (rotated)
     - optional toast notification ("Wysłano N nowych aktywności").
     - Also supports a `-Once` switch (single run, for manual testing) and a `-WhatIf`/dry run.
   - `Install.ps1`:
     - asks for the API URL and token
     - stores the token encrypted with DPAPI (`ConvertTo-SecureString`/`ConvertFrom-SecureString`, current user)
     - writes `config.json`
     - registers a Task Scheduler task "RekordySync" (at logon, current user, hidden, restart on failure)
     - `Uninstall.ps1` removes it.
   - `Diagnose-Mtp.ps1`: lists devices and folders (for the question above).
   - `config.example.json`, `README.md` in Polish (installation, execution policy note, checking logs, troubleshooting: Garmin Express holding the device, MTP folder names).
   - Pester tests for pure functions (state handling, file selection), if feasible without a real device.

## Acceptance criteria
- After connecting the watch, new activities appear in the inbox within about a minute, and already-uploaded files are not sent again.
- Disconnecting mid-copy or network failures do not corrupt `state.json`, and the next connection resumes.
- The installer and uninstaller work without admin rights.
```
