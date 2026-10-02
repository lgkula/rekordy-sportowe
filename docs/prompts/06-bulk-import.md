# Part 6 — Bulk import (Strava / Garmin Connect export)

## Podsumowanie (PL)

- Import eksportu zbiorczego ze Stravy lub Garmin Connect:
  - plik ZIP jest rozpakowywany i analizowany w przeglądarce, więc nawet kilka GB nie obciąża hostingu
  - na serwer trafiają porcjami tylko przetworzone dane.
- Obsługuje pliki FIT, GPX i TCX. Aktywności już zaimportowane są pomijane, a podobne oznaczone do decyzji.
- Wybór trybu:
  - **ręczny**: każda aktywność do zatwierdzenia
  - **automatyczny**: wszystko poza duplikatami zapisuje się samo.
- Pasek postępu, anulowanie i wznawianie.
- Na początku poprosi Cię o przykładowe (lub przycięte) eksporty, żeby zweryfikować ich strukturę.

## Prompt

```
You are implementing Part 6 of the "rekordy-sportowe" project: bulk import from a Strava and/or Garmin Connect account export.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.4, 6, 6.3) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- Q4: which exports I have (Strava, Garmin Connect, both), and ask me for a sample. A trimmed copy is fine: the metadata file(s) + a few activity files. Do NOT assume the export structure. Inspect the real files and show me what you found (columns / JSON fields, especially anything indicating a race and the activity IDs for building URLs).
- Which activity types to import (Run, Trail Run, Virtual Run/treadmill?).
- Where the name should come from when both the export metadata and the file have one (the export's activity name is usually better).
- When the same activity exists in both Strava and Garmin exports: which source wins, and should the URL of the other one be kept?

## Scope
1. `packages/core/bulk`:
   - streaming ZIP reading with fflate in a Web Worker (handle nested zips and `.gz` files)
   - Strava adapter: `activities.csv` (parse with a robust CSV parser; handle the localised column names/date formats in the real export) + `activities/*.fit.gz|gpx(.gz)|tcx(.gz)`; `externalId = strava:<id>`; URL `https://www.strava.com/activities/<id>`
   - Garmin Connect adapter: summarized-activities JSON + uploaded FIT files; `externalId` from the FIT file_id when available, otherwise `garminconnect:<activityId>`; URL `https://connect.garmin.com/modern/activity/<activityId>`
   - GPX/TCX parsers → NormalizedActivity (stream computed from lat/lon via haversine when no distance field exists; elevation smoothing for elevation gain)
   - race flag from export metadata when available, otherwise from the FIT rule of Part 3
   - unit tests with trimmed fixtures from my exports.
2. Server:
   - `POST /api/import/bulk/batch` (editor): batches of ~25 normalised activities with gzipped streams
   - the server re-validates with Zod, recomputes splits/efforts from the stream, applies duplicate detection, and stores results in `import_batches`/`import_items`
   - auto mode: non-duplicates are saved as activities; fuzzy duplicates and errors stay `pending` in the queue
   - manual mode: everything goes to `pending`
   - idempotent: resending the same item must not create duplicates, which makes resume possible.
3. Frontend **Import → Eksport zbiorczy**:
   - ZIP file picker
   - an analysis summary (N aktywności, M biegowych, K już w bazie, L podobnych)
   - a mode switch "Zatwierdzam każdą ręcznie / Automatycznie"
   - progress bar + cancel
   - after upload, the review queue: the same review component as FIT import, with bulk actions (zatwierdź zaznaczone / odrzuć zaznaczone)
   - a final report.
4. Performance: must handle ~2000 activities and multi-GB exports without freezing the UI (workers, batching, streaming) and within the host's request size limits.

## Acceptance criteria
- Importing my sample export creates the expected activities with correct URLs. Re-importing the same export imports nothing new.
- Activities previously imported from FIT files are detected as duplicates (hard or fuzzy).
- Both modes work, and an interrupted import can be resumed.
```
