# Part 2 — Data model, activities & manual entry

## Podsumowanie (PL)

- Tworzy pełny schemat bazy: aktywności, strumienie danych, wyniki rekordów, wydarzenia, kolejka importu.
- Widok **Aktywności**:
  - lista z sortowaniem po nazwie, dystansie i dacie oraz filtrem sportu
  - edycja, usuwanie, przełącznik **trybu ukrytego** (ukryte nie liczą się do rekordów).
- Formularz ręczny w dwóch trybach:
  - **pełny**: wszystkie pola
  - **uproszczony**: nazwa, dystans, data, rekord na wybranym dystansie, link do Garmin/Strava.
- Wykrywanie duplikatów: identyczne ID, nazwa pliku lub hash blokują zapis; podobny czas startu i dystans dają ostrzeżenie do potwierdzenia.
- Zapyta Cię o liczenie rekordów z ręcznych aktywności dłuższych niż dystans docelowy (Q8).

## Prompt

```
You are implementing Part 2 of the "rekordy-sportowe" project: the full data model, the activities list and manual entry.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.1, 4.2, 4.4, 5, 6.1, 7, 8) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- PLAN.md open question Q8: for a manually entered activity without a stream that is longer than a target distance (e.g. 5.3 km, total time only), should it produce a 5 km result, and how?
- PLAN.md open question Q2 if not yet decided: timer time vs elapsed time as the main `duration_s`.
- Default sort of the activity list (date desc?), page size / pagination vs. a full list.

## Scope
1. Drizzle schema + migrations for all tables in PLAN.md section 5: `activities`, `activity_streams`, `efforts`, `events`, `import_batches`, `import_items`, `settings`. Add indexes for the queries in section 7 (e.g. `efforts(sport, distance_key, is_deleted, pace_s_per_km)`).
2. `packages/core`:
   - the `Sport` and `DistanceKey` config (targets in metres, tolerance 10% for targets > 1000 m, `xc_ski` present but flagged as disabled in the UI)
   - Zod schemas for `NormalizedActivity`, the activity create/update DTOs (full and simple variants) and effort DTOs
   - pace/duration helpers, including parsing of Polish-style time input (`mm:ss`, `h:mm:ss`) and distance with a comma.
3. Duplicate detection service in the server (PLAN.md 4.4):
   - hard duplicates: `external_id`, `file_name`, `file_sha256` → 409 with the conflicting activity
   - fuzzy duplicates: start ±2 min and distance ±3% → the response requires `confirmDuplicate: true` to proceed.
4. Activities API (PLAN.md section 7): list (filter by sport, sort by name/distance/date, direction), get, create (full or simple), patch (including `is_hidden`, race flag, notes, URL, edition label), delete (cascades streams/efforts; confirm in the UI).
   - Simple create: builds an activity with `source = manual_simple` and one `efforts` row with `origin = manual` for the selected distance (pace computed; `is_tolerance` computed per the tolerance rule).
   - Full create: every field. Optional manual splits.
   - Leave a clear hook `recomputeEfforts(activityId)` (a stub that is correct for manual activities without streams; Part 4 implements the full engine). Hidden activities stay in the DB, and their efforts are simply excluded by queries.
5. Frontend, **Aktywności** view:
   - a sortable table (Nazwa, Data, Dystans, Czas, Tempo, Sport, Zawody ✓, Ukryta)
   - sport filter tabs
   - hidden rows greyed out, with a quick "ukryj/pokaż" toggle for the editor
   - edit and delete (confirmation modal)
   - an "Dodaj aktywność" button.
6. Frontend, **Formularz**:
   - a toggle "Pełny / Uproszczony"
   - Zod validation shared with the server, friendly Polish error messages
   - a duplicate warning dialog ("Podobna aktywność już istnieje: … Zapisać mimo to?").
7. Tests:
   - schema validation
   - time/distance parsing
   - duplicate detection (hard + fuzzy)
   - activities API integration (CRUD, sorting, hidden, role checks).

## Acceptance criteria
- As editor, I can add an activity in both modes, edit it, hide it, and delete it. As viewer, I can only see the list.
- Sorting by name and by distance works in both directions.
- Adding the same activity twice is blocked (hard) or warned (fuzzy).
```
