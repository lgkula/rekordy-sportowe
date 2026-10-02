# Part 4 — Records engine & records view

## Podsumowanie (PL)

- Silnik rekordów:
  - z każdej aktywności liczy najszybszy odcinek 1 km / 5 km / 10 km / półmaratonu (np. 5 km w ramach 10 km)
  - stosuje tolerancję 10% dla dystansów powyżej 1 km.
- Widok **Rekordy życiowe**:
  - zakładki per sport
  - pokazane tylko dystanse, na których jest wynik
  - top 3 wg tempa, każdy z tempem, czasem (bez czasu dla wyników z tolerancją, zamiast tego oznaczenie i tooltip z faktycznym dystansem) i linkiem do aktywności.
- Edytor może zmienić lub usunąć wynik, a na jego miejsce wskakuje kolejny.
- Ręcznie poprawione wyniki nie są nadpisywane przy przeliczaniu.
- Zapyta Cię o otwarte pytania Q2, Q3 i Q8.

## Prompt

```
You are implementing Part 4 of the "rekordy-sportowe" project: the records engine and the personal records view.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.1, 4.2, 5, 7, 8) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish), unless already answered in the PLAN.md decision log
- Q2: timer time vs elapsed time for segment computation.
- Q3: max one result per activity per distance?
- Q8: activities without a stream that are longer than the target.
- What should happen when an activity is edited (distance/time changed): recompute its computed efforts but keep manually edited ones?

## Domain rules (from PLAN.md, restated; the ranking is ALWAYS by pace)
- Targets: 1k=1000 m, 5k=5000 m, 10k=10000 m, hm=21097.5 m (configurable in packages/core).
- Tolerance only for targets > 1000 m. Qualifies if distance >= 0.9*T.
- If 0.9*T <= distance < T: a tolerance result (pace = duration/actual distance, is_tolerance = true; the UI hides the time and shows the actual distance in a tooltip).
- If distance >= T and a stream exists: the fastest contiguous segment of exactly T metres (a two-pointer sliding window over (time, distance) with linear interpolation at the segment start/end; O(n)).
- Results from hidden activities and soft-deleted efforts are excluded. Top 3 per (sport, distance) ordered by pace asc, tie-break by earlier date.

## Scope
1. `packages/core/records`:
   - `computeEfforts(activity: NormalizedActivity | ActivitySummary): EffortCandidate[]`, a pure function
   - extensive unit tests: exact-distance runs, 4.6 km → 5k tolerance, 0.89*T → nothing, 9.3 km → 10k tolerance + 5k/1k full, a 10 km run with a fast middle 5 km, pauses, interpolation accuracy, 1 km with no tolerance, a half-marathon with GPS distance 21.3 km.
2. Server:
   - implement `recomputeEfforts(activityId)`: upsert computed efforts; never overwrite rows with `is_edited = true` or `is_deleted = true`; remove computed efforts that no longer qualify
   - an admin action `POST /api/admin/recompute-all` (editor) with progress, for when the rules change. Expose it as a button on an editor-only **"Administracja"** page, and also as `node dist/tools.cjs recompute-all` for SSH. In the web version, process in chunks so a single request does not hit the host's request timeout, and so a Passenger process stopped mid-way does not lose progress (e.g. a job row in the DB + status polling that resumes where it stopped).
   - `GET /api/records?sport=` → per distance, the top 3 with activity name, date, pace, time (null when is_tolerance), actual distance, is_tolerance, activity URL, effort id
   - `PATCH /api/efforts/:id` (edit time and/or actual distance, and the activity URL on the parent activity; sets `is_edited`; recalculates pace and is_tolerance)
   - `DELETE /api/efforts/:id` (soft delete)
   - optionally `POST /api/efforts/:id/restore`; ask me if I want a "Przywróć usunięte" list.
3. Frontend **Rekordy życiowe** (the default page after login):
   - sport tabs (Biegi, Biegi przełajowe)
   - one card per distance that has results (1 km, 5 km, 10 km, Półmaraton), each with a table: 🥇🥈🥉 / Tempo / Czas / Data / Aktywność (a link icon to Garmin/Strava if a URL exists)
   - tolerance results: a distinct marker (e.g. "≈" or an asterisk + a muted style), time shown as "—", and a Mantine Tooltip "Dystans: 4,60 km"
   - editor: an edit modal (time, distance, link) and delete with confirmation, followed by an immediate refresh.
   - Empty state when there are no records.
   - Responsive: works on a phone.
4. Integration tests for the records API (hidden activity excluded, deleted effort excluded and the 4th result promoted, the edited effort survives recompute).

## Acceptance criteria
- For my imported activities, the records match what I expect (compare a few with Garmin Connect/Strava best efforts; small differences are OK and should be explained).
- Hiding an activity removes its results from the records immediately.
- Deleting a result promotes the next one. An edited result survives "recompute all".
```
