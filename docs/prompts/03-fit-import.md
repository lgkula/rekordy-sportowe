# Part 3 — FIT parsing & FIT import

## Podsumowanie (PL)

- Parser plików FIT we wspólnym pakiecie, oparty na oficjalnym Garmin FIT SDK. Odczytuje:
  - dane o aktywności
  - strumień czas–dystans–wysokość
  - międzyczasy na każdym kilometrze
  - rodzaj biegu (zwykły / przełajowy)
  - to, czy aktywność to zawody.
- Import wielu plików naraz:
  - pliki są przetwarzane w przeglądarce
  - duplikaty (ten sam plik, nazwa lub ID z zegarka) są odrzucane
  - każdy plik pokazuje się do zatwierdzenia z możliwością poprawienia nazwy, sportu, flagi zawodów i linku.
- Oryginalne pliki są zapisywane na serwerze.
- Na początku poprosi Cię o 2–3 przykładowe pliki FIT (zawody i zwykły trening) i zapyta, jak oznaczasz zawody na zegarku.

## Prompt

```
You are implementing Part 3 of the "rekordy-sportowe" project: FIT parsing and the FIT file import flow.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.1, 4.4, 6, 6.2) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- PLAN.md Q1: how I mark races on my Fenix 7X (a dedicated activity profile? Garmin race calendar / "Race" event? nothing?). Ask me for 2–3 sample FIT files (at least one race, one ordinary road run, one trail run if available) and where to put them (e.g. `packages/core/test/fixtures/`, which should be git-ignored if I don't want them committed).
- PLAN.md Q2 if not decided: timer time vs elapsed time.
- Whether the activity URL can be derived automatically (it usually cannot from a FIT file, so it is entered manually or comes from the bulk import later).

## Scope
1. `packages/core/fit`: a parser built on `@garmin/fitsdk` (Decoder + Stream). It must work in the browser and in Node. It produces `NormalizedActivity`:
   - `externalId = garmin:<serial_number>:<time_created>` from `file_id`, plus the file name and SHA-256 (use Web Crypto in the browser and `crypto` in Node, behind one interface)
   - sport mapping: `running` + `trail` → `trail_run`; `running` + street/generic/track/treadmill?(ask me about treadmill) → `road_run`; `cross_country_skiing` → `xc_ski`; other sports → unsupported (reported, not imported)
   - summary from `session`: distance, timer time, elapsed time, total ascent, start time
   - stream from `record` messages: timer-based time axis (skip paused periods using `event` timer start/stop messages), distance, altitude. Drop samples with missing distance and enforce monotonic distance.
   - per-km splits computed from the stream (last partial km included and flagged), with elevation gain per split
   - race detection per the findings from my sample files, with `isRaceConfidence`. Inspect my files and SHOW ME which FIT fields/values indicate a race before implementing the rule.
   - activity name default: sport profile name + local date (editable).
2. Unit tests using my fixture files (plus a small synthetic stream generator for edge cases: pauses, GPS jumps, very short files, a corrupt file → a clean error).
3. Server:
   - `POST /api/import/check` (batch duplicate check by externalId/fileName/sha256)
   - `POST /api/import/fit` (multipart, editor): accepts approved files + user overrides (name, sport, isRace, eventId/edition label placeholder, URL, notes), re-parses them on the server (never trust the client's parse), runs the duplicate checks, stores the activity + `activity_streams` (gzip) + splits, stores the raw file gzipped under `storage/fit/<yyyy>/<sha256>.fit.gz`, and calls `recomputeEfforts`.
   - Check the hosting's upload size limits and set the Fastify multipart limits accordingly.
4. Frontend **Import → Pliki FIT**:
   - a Mantine Dropzone (multiple files)
   - in-browser parsing in a Web Worker
   - an immediate duplicate check
   - a list of files with status (nowy / duplikat / błąd / nieobsługiwany sport)
   - a **review step for each new file**: summary (date, distance, time, pace, elevation, detected sport, race flag + where it came from, preview of splits and of the efforts that would be created), editable fields, and buttons "Zatwierdź" / "Pomiń"; plus "Zatwierdź wszystkie pozostałe"
   - a final summary.
5. Activity detail (read-only): show splits (table + a small bar chart via @mantine/charts). This is reused later by the races view.

## Acceptance criteria
- Importing my sample files gives correct distance/time/pace/elevation (compare with Garmin Connect, max ~1% difference), a correct sport, and a correct race flag.
- Importing the same file again (or a renamed copy) is detected as a duplicate.
- Multiple files can be dropped at once, and each one is reviewed before saving.
```
