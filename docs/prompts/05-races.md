# Part 5 — Races / events view

## Podsumowanie (PL)

- Widok **Zawody**, osobno dla każdego sportu:
  - kolejne edycje tego samego biegu są zgrupowane w jedno wydarzenie
  - na liście: nazwa, dystans, najlepsze tempo ze wszystkich edycji, a dla przełajów także przewyższenie
  - kolejność ustawiana ręcznie (przeciąganie) albo sortowanie po nazwie.
- Kliknięcie w wydarzenie rozwija jego edycje (dodatkowa nazwa np. „jesień”, data, tempo). Kliknięcie w edycję pokazuje tempo na kilometrach i notatki.
- Przypisywanie aktywności do wydarzeń z podpowiedzią po podobieństwie nazwy, także przy imporcie.
- Zapyta o przewyższenie (Q6) i edycję dystansu wydarzenia (Q9).

## Prompt

```
You are implementing Part 5 of the "rekordy-sportowe" project: the races (competitions) view with events and editions.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (sections 4.3, 5, 7, 8) and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- Q6: which elevation gain to show on the trail event list (best-pace edition, latest edition, or average).
- Q9: the event distance: computed from editions or manually overridable?
- Should hidden race activities still appear in the races view? (Hidden mode is defined for records; ask.)
- Should the "best pace" on the event list consider only full-distance editions, or all?
- Race activities not assigned to any event: show them as single-edition events automatically, or in an "Nieprzypisane" section?

## Scope
1. Server:
   - events CRUD (`/api/events`), scoped by sport
   - `GET /api/events?sport=` returns the aggregated list: name, display distance, best pace across editions (+ which edition), elevation gain per the Q6 decision (trail_run only), edition count, sort_order
   - `GET /api/events/:id` returns the editions ordered by date desc: edition label, date, pace, time, distance, activity id
   - `PUT /api/events/order {sport, ids[]}` saves the manual order
   - settings `events.ordering.<sport>` = 'manual' | 'name'
   - an assignment endpoint (or via activity PATCH): set `event_id` + `edition_label` on an activity
   - `GET /api/events/suggest?name=&sport=` returns events with a similar name (normalised: lowercase, no Polish diacritics, no years/ordinals/edition words like "edycja", "XV", "2024", then token similarity).
2. Frontend **Zawody**:
   - sport tabs
   - a toggle "Kolejność: Ręczna / Nazwa"
   - a list/accordion of events with columns: Nazwa, Dystans, Najlepsze tempo, (Przewyższenie for przełaje), Liczba edycji
   - in manual mode, the editor sees drag handles (dnd-kit), and the order saves on drop
   - clicking an event expands its editions (Nazwa edycji e.g. "jesień", Data, Tempo)
   - clicking an edition opens a detail panel or modal: per-km splits table + bar chart (reuse from Part 3), notes, and a link to the activity.
3. Editor tools:
   - create/rename/merge/delete events
   - move an edition to another event
   - edit the edition label and notes
   - in the activity form and the FIT import review step, a "Wydarzenie" combobox with suggestions + "Utwórz nowe", and an "Edycja" text field (only when "Zawody" is checked).
4. Tests: aggregation queries (best pace across editions, elevation choice), ordering persistence, suggestion normalisation (Polish diacritics, years, Roman numerals).

## Acceptance criteria
- Two editions of the same race appear as one event with the best pace of both.
- The manual order survives a reload. Switching to "Nazwa" sorts alphabetically with Polish collation.
- Clicking an edition shows the per-km paces and my notes.
```
