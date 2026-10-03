# Sports Records Web App — Implementation Plan

> Working name: **rekordy-sportowe**
> Plan language: English. The Polish summary is in the last section ([Podsumowanie po polsku](#podsumowanie-po-polsku)).
> Implementation prompts for every part: [docs/prompts/](prompts/README.md).

---

## 1. Goals and scope

A personal web app that shows one athlete's sports records. It does four things:

1. Shows **personal records** (top 3 results per distance) separately for each sport.
2. Shows a **list of races (competitions)**. Editions of the same race are grouped into one event.
3. Manages the **list of activities** they come from: CRUD, hidden mode, duplicate detection.
4. Brings data in from **manual entry**, **FIT files**, **bulk exports (Strava / Garmin Connect)** and a **Windows script** that syncs FIT files from a Garmin watch (Fenix 7X Sapphire Solar, firmware 27.18, **MTP** connection).

Sports:

| Code (in code) | UI label (PL) | Status |
|---|---|---|
| `road_run` | Biegi | MVP |
| `trail_run` | Biegi przełajowe | MVP (also tracks elevation gain) |
| `xc_ski` | Narciarstwo biegowe | Future. The data model supports it from day one; hidden in the UI. |

Record distances for `road_run` and `trail_run`: **1 km, 5 km, 10 km, half marathon (21.0975 km)**. The list of distances is configuration, not hard-coded logic.

---

## 2. Confirmed decisions

| # | Decision | Source |
|---|---|---|
| D1 | Hosting: shared hosting with **Node.js + MySQL** (and PHP). **No Docker**, no Fly.io/Render. | user |
| D2 | Records are **always ranked by pace**. Results that qualify only through the distance tolerance **do not show time**, only pace. A tooltip shows the actual distance. | user |
| D3 | Watch: Garmin **Fenix 7X Sapphire Solar**, fw 27.18. It connects over **MTP** (no drive letter), so the Windows script must use MTP. | user |
| D4 | UI language: **Polish only**. Strings live in one module, so i18n can be added later. | user |
| D5 | Code, identifiers, comments, commits and docs: English. Communication with the user, including clarifying questions: **Polish**. | prompt.md |
| D6 | When in doubt during planning or implementation, **ask the user** (in Polish) before deciding. | prompt.md |
| D7 | Hosting: **Seohost**, **Node.js v22.23.2**, **SSH/terminal available**. The Node.js app **process is started and restarted only by the panel's Node.js app manager (Passenger)**, never as a self-managed process. Everything else (npm, migrations, scripts, cron) may run over SSH. See 3.2. | user |

---

## 3. Technology stack

The main constraint is a shared host that runs Node.js without Docker. The server bundle must be light: **no native Node modules**, few runtime dependencies. The process is started by the panel's Node.js app manager under Passenger (D7). Target runtime: **Node.js 22**.

### 3.1 Overview

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for front, back, shared parsing code and tests. |
| Repo | **npm workspaces** monorepo: `apps/web`, `apps/server`, `packages/core` | `packages/core` holds the domain logic (FIT parsing, records engine, pace math). It runs in both the browser and Node. |
| Frontend | **React + Vite**, **React Router**, **TanStack Query** | Static SPA build, served by the Node server. No SSR needed. |
| UI kit | **Mantine** (+ `@mantine/dates`, `@mantine/dropzone`, `@mantine/charts`), **dnd-kit** for manual ordering | Ready-made tables, forms, tooltips, modals, dropzone and a Polish date locale (dayjs `pl`). |
| Backend | **Fastify** + **Zod** (via `fastify-type-provider-zod`) | Fast, small and typed. The same Zod schemas validate forms on the frontend. |
| DB | **MySQL / MariaDB** (from hosting) + **Drizzle ORM** + `drizzle-kit` migrations, driver `mysql2` (pure JS) | Light, no binary engine (unlike Prisma), SQL-first, typed. |
| FIT parsing | **`@garmin/fitsdk`** (official Garmin JavaScript SDK) | Runs in the browser and in Node. Reads `file_id`, `session`, `lap`, `record`, `sport` messages. |
| GPX/TCX (bulk only) | `fast-xml-parser` | Strava exports contain GPX/TCX for some activities. |
| ZIP / GZ in browser | **fflate** | Unpacks multi-GB bulk exports in the browser with streaming. Nothing large is uploaded to the host. |
| Auth | Signed httpOnly cookie (HMAC, `@fastify/cookie`), password hashing with built-in **`crypto.scrypt`** | No native deps (no bcrypt/argon2 binaries). |
| Build / bundle | Vite (web), **tsup/esbuild** (server bundled with **all dependencies inlined** into `dist/server.cjs`) | No `node_modules` / `npm install` on the host (this avoids the panel's virtual-env `node_modules` symlink). Passenger only needs the startup file `app.js`. |
| Tests | **Vitest** (unit and integration), **Playwright** (a few e2e smoke tests) | |
| Lint / format | ESLint + Prettier | |
| Windows sync | **PowerShell 5.1** (built into Windows 10) + `Shell.Application` COM for MTP + `curl.exe` for multipart upload + Task Scheduler | Nothing to install on the user's PC. |

### 3.2 Hosting and deployment model

**Hosting: Seohost** (shared). **SSH/terminal is available**, so npm, builds, migrations and maintenance scripts can be run over SSH. The only restriction is that **the Node.js app process cannot be started or kept alive by hand** (no `node server.js &`, no pm2/forever/nohup). The panel's **Node.js application manager** starts it (D7). It runs the app under **Phusion Passenger**.

Panel "Utwórz aplikację" form (from the user's screenshot) and the values we plan to use:

| Panel field | Value |
|---|---|
| Wersja Node.js | **22.x** (the host offers v22.23.2; the panel's default 10.24.1 must be changed) |
| Tryb aplikacji | **Production** (sets `NODE_ENV=production`) |
| Katalog główny aplikacji | app root **outside `public_html`**, e.g. `~/apps/rekordy-sportowe` (to confirm in part 0) |
| URL aplikacji | the chosen domain/subdomain (+ optional path) |
| Plik startowy aplikacji | **`app.js`** (CommonJS) |
| Environment variables | `NODE_ENV` comes from the mode. Other config lives in `.env`, see below. |

This panel looks like the CloudLinux Node.js Selector, but that is not confirmed. Verify in part 0. Consequences for the implementation:

- **Passenger integration**
  - The startup file `app.js` is loaded by Passenger. Keep it **CommonJS** (Passenger's ESM support differs between versions); it just `require`s `dist/server.cjs`.
  - The server calls `fastify.listen({ port: Number(process.env.PORT) || 3000 })`. Passenger takes over `listen()`, so the port is never hard-coded. Part 0 verifies this with a minimal spike before building on it.
- **Process lifecycle under Passenger**
  - The app may start lazily on the first request, be stopped after idle time, or run in more than one process.
  - So nothing important lives only in memory: no in-process cron or timers for critical work, and sessions are stateless cookies.
  - Long jobs (recompute-all) are chunked and resumable.
  - Expect a cold start after idle.
- **Restart**:
  - the "Restart" button in the panel, or
  - over SSH: `touch <app-root>/tmp/restart.txt` (standard Passenger), or the selector's CLI if the host provides it (e.g. `cloudlinux-selector restart --json --interpreter nodejs --app-root <app-root>`).
  - Part 0 checks which one works on Seohost. The deploy script uses it.
- **Dependencies**: in CloudLinux-style selectors, `node_modules` in the app root is a symlink into a virtual environment managed by the panel. `npm install` must then be run with the panel's "Run NPM Install" button, or over SSH after activating that environment (the command is shown in the panel). To avoid this, **the server is bundled with esbuild/tsup into one `dist/server.cjs` with all dependencies inlined**, so the host needs no `node_modules` at all. No native modules.
- **Build locally** (or in CI), not on the host. Shared-hosting resource limits (memory/processes) make builds on the server unreliable.
- **Deploy script** (`npm run deploy`, run locally):
  1. build + package
  2. `rsync` over SSH into the app root (keep `.env` and `storage/` untouched)
  3. run migrations over SSH: `node dist/migrate.cjs` (uses the host's Node 22 binary; path confirmed in part 0)
  4. restart (touch `tmp/restart.txt` or the selector CLI)
  5. check `GET /api/health`.
- **Configuration**: secrets and DB credentials live in **`<app-root>/.env`** (chmod 600, outside the web root). Both the Passenger-started app and SSH scripts (migrations, maintenance) then read the same source. Panel env vars are used only for `NODE_ENV` (set by "Tryb aplikacji"). Values set in the panel override `.env`.
- **Migrations**:
  - run explicitly by the deploy script over SSH
  - at startup the app checks the schema version; if migrations are pending it logs an error and `/api/health` reports it (no automatic migration inside Passenger workers).
- **Maintenance**:
  - CLI tasks in `dist/tools.cjs`, run over SSH, e.g. `hash-secret`, `recompute-all`, `backup`, `restore`
  - the tasks useful day to day also get buttons on an editor-only "Administracja" page (recompute all, status).
- **Scheduled tasks** (backups): the panel's cron (to confirm), running `node dist/tools.cjs backup` (or `mysqldump` if available).
- **Logs**: Passenger/stderr logs where the panel exposes them, plus the app's own rotated log file in `storage/logs/`.
- Uploaded raw FIT files go to `storage/fit/<yyyy>/<sha256>.fit.gz`, outside the public web root. They are kept so records can be recomputed if the rules change. The `storage/` path must be writable by the app process (checked at startup; `/api/health` reports it).

---

## 4. Domain rules

### 4.1 Distances and tolerance

- Targets: `1k = 1000 m`, `5k = 5000 m`, `10k = 10000 m`, `hm = 21097.5 m`.
- **Tolerance applies only to targets > 1 km**: an activity qualifies for target `T` when `distance ≥ 0.9 × T` (e.g. 4.6 km counts for 5 km). For 1 km the full distance is required.
- A result from an activity with `0.9·T ≤ distance < T` is a **tolerance result**:
  - `pace = duration / actual_distance`
  - it is marked visually (an icon or asterisk)
  - the **time is not shown** (D2)
  - a tooltip shows the actual distance (e.g. "Dystans: 4,60 km").
- Longer activities: for every target `T ≤ distance`, the **fastest contiguous segment** of exactly `T` metres is computed from the stream (two-pointer sliding window over `(timer_time, distance)` samples, with linear interpolation at the edges). Example: a 10 km run can set a 5 km and a 1 km record.
- An activity with `0.9·T ≤ distance < T` for one target can still give full results for smaller targets. Example: a 9.3 km run gives a 10 km tolerance result plus full 5 km and 1 km results.

### 4.2 Records (the "top 3")

- Records are shown **per sport, per distance**. Only distances with at least one result are displayed.
- Each distance shows the **3 best results of all time**, ranked by **pace** (ascending). The three together make up "the record".
- Each result shows **pace (min/km)** and **time** (except tolerance results). It links to the activity URL (Garmin Connect / Strava) when one was provided.
- Results from **hidden activities** are excluded.
- **One activity gives at most one result per distance** (default, see open question Q3).
- Results live in a **`efforts`** table (materialised best efforts). They are:
  - computed automatically on import or edit
  - **editable** (time / distance / link) and **deletable** (soft delete, so recomputation does not bring them back); the next result moves up automatically
  - entered directly in **simplified manual entry** ("record on a chosen distance").

### 4.3 Races and events

- An activity can be flagged **`is_race`**. The flag comes from the FIT file when possible (see 6.2), is set manually otherwise, and can always be edited.
- A race activity can belong to an **event** (e.g. "Bieg Niepodległości") with an optional **edition label** (e.g. "jesień", "2024"). On import the app suggests an existing event by name similarity; the user confirms or creates a new one.
- A race activity without an event is listed as a **one-edition event** of its own until it is assigned.
- Event list (per sport):
  - event name
  - distance (the most common edition distance, editable)
  - **best pace across all editions** (hidden editions are shown greyed out but do not count)
  - for `trail_run`, also **elevation gain** (from the best-pace edition, Q6)
  - ordering: **manual (drag & drop, editor only)** or **by name**. The ordering mode is saved as a setting.
- Clicking an event expands its editions: edition label, date, pace.
- Clicking an edition shows **per-km splits** (table plus a small bar chart) and the **notes**.

### 4.4 Activities

- List per sport (or all), sortable by **name** and **distance** (and by date as default).
- Edit and delete. A **hidden** toggle excludes the activity from records (it stays in the activity list, greyed out).
- **Duplicate detection**, from strongest to weakest signal:
  1. same FIT `file_id` (`serial_number` + `time_created`) → `external_id = garmin:<serial>:<time_created>`
  2. same original **file name**
  3. same file **SHA-256**
  4. same external ID from Strava (`strava:<activity_id>`)
  5. **fuzzy cross-source match**: start time within ±2 min and distance within ±3%. This is shown as a warning and the user decides.
- Signals 1–4 block the import (the item is shown as "duplicate"). Signal 5 needs confirmation.

### 4.5 Access and roles

| Role | How | Rights |
|---|---|---|
| `viewer` | Fixed password **`lk`** (configurable, stored as a hash) | Read only |
| `editor` | Strong password (hash in `.env`) | Full CRUD, imports |
| `agent` | Bearer API token (hash in `.env`) | Only `POST /api/agent/fit` (upload to the import inbox) |

- A single login form: the password decides the role.
- **Role switch** in the header:
  - viewer → editor asks for the editor password
  - editor → viewer happens without a password.
- **"Zapamiętaj w tej przeglądarce" checkbox**:
  - checked → persistent cookie (90 days, sliding)
  - unchecked → browser-session cookie, also expired by the server after 96 h of inactivity (sliding).
- Other security measures:
  - cookies are httpOnly, `Secure`, `SameSite=Strict`, HMAC-signed, and carry role + expiry + `secretVersion` (bumping it logs everyone out)
  - login rate limit: failed passwords per IP counted in the DB (`auth_failures`), 10 per 15 min
  - all mutations are checked on the server for the `editor` role.

---

## 5. Data model (MySQL, Drizzle)

```
activities
  id                PK
  sport             ENUM('road_run','trail_run','xc_ski')
  name              VARCHAR
  start_time_utc    DATETIME NULL      -- NULL when only the date is known (manual entry)
  local_date        DATE               -- for display/grouping
  distance_m        DECIMAL(9,1)
  duration_s        DECIMAL(9,1) NULL  -- timer time (auto-pause excluded), Q2; NULL only for a simplified entry without it
  elapsed_s         DECIMAL(9,1) NULL
  elevation_gain_m  INT NULL
  is_race           BOOL
  is_hidden         BOOL
  event_id          FK events NULL
  edition_label     VARCHAR NULL
  notes             TEXT NULL
  activity_url      VARCHAR NULL       -- Garmin Connect / Strava link
  source            ENUM('manual','manual_simple','fit','strava_export','garmin_export','agent')
  external_id       VARCHAR NULL UNIQUE
  file_name         VARCHAR NULL UNIQUE
  file_sha256       CHAR(64) NULL UNIQUE
  splits            JSON NULL          -- [{km, distanceM, durationS, elevationGainM?, partial?}]
  has_stream        BOOL
  created_at / updated_at

activity_streams
  activity_id       PK/FK
  data              MEDIUMBLOB         -- gzip JSON {t:[timer s], d:[m], alt:[m]} (1 Hz)

efforts
  id                PK
  activity_id       FK
  sport             ENUM (denormalised for fast queries)
  distance_key      VARCHAR ('1k','5k','10k','hm')
  target_m          DECIMAL
  actual_distance_m DECIMAL
  duration_s        DECIMAL
  pace_s_per_km     DECIMAL
  is_tolerance      BOOL
  origin            ENUM('computed','manual')
  is_edited         BOOL               -- manual override → recomputation must not overwrite
  is_deleted        BOOL               -- soft delete
  UNIQUE(activity_id, distance_key)

events
  id, sport, name, display_distance_m NULL, sort_order INT, created_at

import_items                           -- review queue for FIT/bulk/agent imports
  id, batch_id, source, file_name, file_sha256, external_id,
  status ENUM('pending','approved','rejected','duplicate','error'),
  parsed JSON                          -- normalised activity preview
  duplicate_of_activity_id NULL, error TEXT NULL, created_at

import_batches
  id, source, auto_approve BOOL, created_at, summary JSON

settings
  key PK, value JSON                   -- e.g. events.ordering = 'manual' | 'name'
```

---

## 6. Import pipelines

All pipelines produce the same **`NormalizedActivity`** (defined in `packages/core`):

```ts
{ sport, name, startTimeUtc, localDate, distanceM, durationS, elapsedS?, elevationGainM?,
  isRace, isRaceConfidence: 'fit' | 'heuristic' | 'none',
  externalId?, fileName?, fileSha256?, activityUrl?,
  stream?: { t: number[]; d: number[]; alt?: number[] },
  splits?: Split[] }
```

`packages/core` then computes the efforts. The server re-validates and recomputes on save. The client result is only a preview.

### 6.1 Manual entry

- **Full form**: every activity field. Optional manual splits. Race flag, event and edition label, notes, URL.
- **Simplified form** (toggle) with only:
  - name
  - distance
  - date
  - **record on a chosen distance** (distance key + time; pace is computed)
  - Garmin Connect / Strava link.

  It creates an activity with `source = manual_simple` and one `manual` effort.

### 6.2 FIT import (web)

- A multi-file dropzone (`.fit`, and `.zip` archives such as Garmin Connect's "export original", unpacked in the browser). Files are parsed **in the browser** with `packages/core`, so the preview is instant. After approval the raw files are sent to the server, which re-parses them and stores them.
- Duplicate check before preview: `POST /api/import/check` with `{fileName, sha256, externalId}` for all files.
- **A review step for every file**:
  - summary, detected sport, detected race flag, computed efforts and splits
  - the user can edit the name, sport, race flag, event and URL
  - actions: approve / skip.
- **Race detection from FIT** (to verify on the user's real files, see open question Q1). Candidates:
  - the `sport` message `name` (activity profile name, e.g. a dedicated "Race"/"Zawody" profile)
  - `session`/`activity` event fields
  - workout or course names
  - Race-calendar-related fields on newer firmware.

  If nothing reliable is found: a heuristic plus a manual checkbox.
- Sport detection: `sport=running` + `sub_sport=trail` → `trail_run`; `sub_sport=street/generic/track` → `road_run`; the user can override.

### 6.3 Bulk import (Strava / Garmin Connect export)

- The user selects the export **ZIP**. It is unpacked and parsed **in the browser** (fflate + Web Worker), so only normalised data (+ small gzipped streams) is uploaded, in batches.
- **Strava export**:
  - `activities.csv` (ID, name, type, date, distance, elapsed/moving time, filename, …)
  - `activities/*.fit.gz | *.gpx(.gz) | *.tcx(.gz)`
  - only running types are imported
  - `externalId = strava:<id>`
  - URL `https://www.strava.com/activities/<id>`.
- **Garmin Connect export**:
  - `DI_CONNECT/DI-Connect-Fitness/*summarizedActivities*.json` (metadata; may contain event type = race)
  - `DI_CONNECT/DI-Connect-Uploaded-Files/*.zip` (original FIT files)
  - URL `https://connect.garmin.com/app/activity/<activityId>`
  - the exact structure must be verified on a real export (open question Q4).
- A **mode switch**:
  - *manual review* goes item by item (same review UI as FIT import)
  - *automatic* approves all non-duplicates and puts fuzzy-duplicate warnings in the queue.
- Progress bar, cancel and resume. Resume works because the server remembers the `import_items` already sent.

### 6.4 Windows sync agent

- `tools/windows-sync/`:
  - `Sync-GarminFit.ps1` (watcher + uploader)
  - `Install.ps1` (registers a Task Scheduler task at logon, stores config)
  - `config.example.json`
  - `README.md` (Polish).
- Detection: the task starts at logon. It waits for device arrival (`Register-CimIndicationEvent` on `Win32_DeviceChangeEvent`, with a 30 s polling fallback), then looks for the MTP device named like `fenix 7X*` under `Shell.Application` → *This PC*.
- Reading: `<device>\Internal Storage\GARMIN\Activity\*.fit`, copied through `Shell.Application` `CopyHere`. The copy is asynchronous, so the script waits until the file size is stable. Files go to a local staging folder.
- A local state file (`state.json`) lists names and hashes already uploaded. Only new files are uploaded.
- Upload: `curl.exe -A "RekordySync/<version>" -F file=@... -H "Authorization: Bearer <token>" https://<host>/api/agent/fit`. The server deduplicates too. **A custom User-Agent is mandatory**: the host's bot protection answers 429 to curl's default UA.
- Server side: the file goes to the **import inbox** (`import_items`, status `pending`), where the editor approves it in the UI. An **auto-approve setting** exists (open question Q5).
- The token is stored encrypted with Windows DPAPI (`ConvertFrom-SecureString`). Logs go to `%LOCALAPPDATA%\RekordySync\sync.log`. An optional toast notification reports "Wysłano N nowych aktywności".

---

## 7. API (summary)

```
POST   /api/auth/login            {password, remember}          → sets cookie, returns role
POST   /api/auth/logout
POST   /api/auth/switch           {targetRole, password?}
GET    /api/auth/me

GET    /api/records?sport=
PATCH  /api/efforts/:id           (editor) time / actual distance (sets is_edited), activity link
DELETE /api/efforts/:id           (editor, soft)
GET    /api/efforts/deleted?sport= (editor) soft-deleted results, for restoring
POST   /api/efforts/:id/restore   (editor)
POST   /api/efforts/:id/reset     (editor) drop the manual edit of a computed result

GET    /api/activities?sport=&sort=name|distance|date&dir=
GET    /api/activities/:id        (with splits, notes)
POST   /api/activities            (editor, full or simple)
PATCH  /api/activities/:id        (editor; includes is_hidden)
DELETE /api/activities/:id        (editor)

GET    /api/events?sport=         (aggregated best pace, distance, elevation; races without an event as one-edition entries)
GET    /api/events/suggest?sport=&name=   events with a similar name
GET    /api/events/:id            (editions)
POST   /api/events | PATCH /api/events/:id | DELETE /api/events/:id   (editor)
POST   /api/events/:id/merge      (editor) {targetId}
PUT    /api/events/order          (editor) {sport, ids[]}
GET/PUT /api/settings/:key        (PUT: editor) events.ordering.<sport> = 'manual' | 'name'
Event assignment: eventId / newEventName + editionLabel on POST/PATCH /api/activities and in the FIT import meta.

POST   /api/import/check          (editor) duplicate check
POST   /api/import/fit            (editor) multipart, approved files
POST   /api/import/bulk/batch     (editor) normalised activities batch
GET    /api/import/inbox          (editor)
POST   /api/import/inbox/:id/approve | /reject   (editor)

POST   /api/agent/fit             (agent token) multipart

GET    /api/admin/status          (editor) version, pending migrations, DB, storage writability
GET    /api/admin/recompute-all   (editor) latest recompute job (running, interrupted or done)
POST   /api/admin/recompute-all   (editor) start the chunked, resumable job (or return the running one)
GET    /api/admin/jobs/:id        (editor) job progress
POST   /api/admin/jobs/:id/run    (editor) process the next chunk
```

The same maintenance tasks also exist as SSH CLI commands in `dist/tools.cjs` (`migrate`, `recompute-all`, `backup`, `restore`, `hash-secret`).

---

## 8. UI (Polish labels)

| Route | View | Notes |
|---|---|---|
| `/login` | Login | Password field + "Zapamiętaj w tej przeglądarce" |
| `/records` | **Rekordy życiowe** | Tabs per sport. Cards per distance, each with a top-3 table (miejsce, tempo, czas, data, nazwa, link). Tolerance marker + tooltip. Editor: edit/delete per row. |
| `/races` | **Zawody** | Tabs per sport. Sort toggle (Ręcznie / Nazwa). Accordion of events → editions → splits + notes. Drag handles in editor + manual mode. |
| `/activities` | **Aktywności** | Sortable table, hidden toggle, edit/delete, "Dodaj" button. |
| `/activities/new`, `/activities/:id/edit` | Formularz | Full / Uproszczony toggle |
| `/import` | **Import** | Tabs: Pliki FIT, Eksport zbiorczy, Skrzynka (agent inbox) |
| `/admin` | **Administracja** (editor) | Recompute all records (progress, resume), deleted results with "Przywróć" |

The header shows the current role and a role switch. Editor-only controls are hidden for viewers.

Formatting helpers: pace `m:ss /km`, time `h:mm:ss`, distance `21,10 km` (Polish decimal comma), dates `dd.MM.yyyy`.

---

## 9. Implementation parts

Each part is one Claude Code session with its own prompt in `docs/prompts/`. Parts are ordered by dependency. Each ends with working, tested and deployable software.

| # | Part | Depends on | Key deliverables |
|---|---|---|---|
| 0 | **Scaffold & deployment skeleton** | – | A Passenger "hello" spike first. Then: monorepo, Fastify serving the SPA, MySQL connection + Drizzle, self-contained server bundle, CLAUDE.md, deploy script (rsync + migrations + restart over SSH), a Seohost panel setup guide, the app live on the host (started from the panel). **This validates the hosting first.** |
| 1 | **Auth & roles** | 0 | Login, viewer/editor/agent, role switch, remember-me, route guards, rate limit |
| 2 | **Data model, activities & manual entry** | 1 | Full schema + migrations, activities CRUD + list view, full & simplified forms, hidden mode, duplicate detection (fuzzy + external IDs) |
| 3 | **FIT parsing & FIT import** | 2 | `packages/core` FIT → NormalizedActivity (stream, splits, sport, race flag), multi-file import with per-file review, raw file storage |
| 4 | **Records engine & records view** | 3 | Best-effort algorithm with tolerance, `efforts` recomputation, records API + view with tooltips, edit/delete of results |
| 5 | **Races / events view** | 4 | Events CRUD, edition assignment (with suggestions), aggregated list, manual ordering, splits + notes detail |
| 6 | **Bulk import (Strava / Garmin Connect)** | 3, 4 | Browser-side ZIP processing, Strava and Garmin parsers (FIT/GPX/TCX), batch upload, manual/auto approval |
| 7 | **Windows sync agent** | 3 | Agent endpoint + inbox UI, PowerShell MTP watcher + installer + Polish README |
| 8 | **Hardening & release** | all | E2E smoke tests, backups (DB dump script), error pages, performance check, final deployment docs (Polish user guide) |

---

## 10. Open questions (to ask in Polish during the related part)

| ID | Question | Part | Default if not answered |
|---|---|---|---|
| Q1 | How are races marked on the watch (a dedicated activity profile? Garmin race calendar?). Please provide 2–3 sample FIT files (race and non-race). | 3 | **Decided (Part 3):** a dedicated activity profile, "Bieg zawody"; the race flag comes from the profile name. See the decision log. |
| Q2 | Should records use **timer time** (auto-pause excluded) or **elapsed time**? | 3, 4 | **Decided (Part 2): timer time** |
| Q3 | Can one activity give more than one result per distance (e.g. two 5 km segments of a 10 km run)? | 4 | **Decided (Part 4):** no, one per activity per distance |
| Q4 | Which exports are available (Strava, Garmin Connect, both)? Please provide sample exports (or a trimmed version). | 6 | Support both |
| Q5 | Should files sent by the Windows script be approved manually (inbox) or automatically? | 7 | Inbox (manual) with an auto-approve setting |
| Q6 | For the trail-running event list: which elevation gain to show (best edition's, latest edition's, or average)? | 5 | **Decided (Part 5):** from the edition with the best pace |
| Q7 | Remaining Seohost details: app root path, domain/subdomain for the app, the Node 22 binary path over SSH (or the env activation command shown by the panel), whether `tmp/restart.txt` or a selector CLI restarts the app, where Passenger logs are visible, cron availability, MySQL vs MariaDB version. Known already: SSH available, Node v22.23.2, panel form fields (screenshot). | 0 | Ask. Blocks deployment. |
| Q8 | For manually entered activities without a stream that are longer than a target (e.g. 5.3 km with total time only): count them for 5 km using average pace, or not? | 2, 4 | **Decided (Part 2):** `T ≤ d ≤ 1.01·T` → full result, time scaled to T; `0.9·T ≤ d < T` or `1.01·T < d ≤ 1.1·T` → tolerance result (average pace, no time shown); no tolerance for 1 km; otherwise nothing. See the decision log. |
| Q9 | Should the event distance shown in the list be editable, or always computed from editions? | 5 | **Decided (Part 5):** computed, with manual override |

---

## 11. Quality and conventions

- TypeScript `strict`. Shared Zod schemas live in `packages/core`.
- `packages/core` must have **high unit-test coverage**: pace math, best-effort sliding window, tolerance rules, FIT normalisation (fixtures from the user's real files, anonymised if needed).
- Each API route gets an integration test (Vitest + a test MySQL database, or MySQL started locally without Docker, e.g. an XAMPP/MariaDB install; to be agreed in part 0).
- UI strings live in `apps/web/src/i18n/pl.ts`.
- Commit messages follow Conventional Commits.
- Each part ends by updating the **Status** table below and the **Decision log**.

### Status

| Part | Status |
|---|---|
| 0 | **done** (2026-10-02): scaffold, CI/deploy scripts, docs; spike verified on the host; first `npm run deploy` OK and https://sport.kula.opole.pl/api/health returns `ok`. Repo pushed to GitHub; deploy secrets set and the first GitHub Actions deploy OK (run 37067882668, `8c0e2d6`, `/api/health` ok). |
| 1 | **done** (2026-10-02): scrypt hashes + `hash-secret` CLI, signed stateless session cookie (96 h / 90 days, sliding), login/logout/me/switch, default role guards + agent bearer token, DB-backed failed-attempt limit, login page, role badge/switch/logout in the header, `useCanEdit()`. Deployed (`c694de3`), secrets set on the host, `/api/health` ok; verified in production: `request.ip` is the real client IP behind LiteSpeed (a forged `X-Forwarded-For` is ignored), cookie flags `HttpOnly; Secure; SameSite=Strict`. |
| 2 | **done** (2026-10-02, deployed `7b0822c`; production `/api/health` ok with 3 migrations applied, `/api/activities` answers 401 without a session): migration `0002_data_model` (all tables of section 5, indexes, FK cascades; verified on MariaDB 10.4), `packages/core` (sports/distances config, tolerance + Q8 rule, Polish time/distance parsing, shared Zod schemas, fuzzy-duplicate rule), duplicate detection service, activities API (list/get/create full+simple/patch/delete) with `recomputeEfforts` stub, **Aktywności** view (sport tabs, sortable paginated table, hidden toggle, edit, delete modal) and the form (Pełny/Uproszczony, splits, duplicate dialog). Tests: core unit, web form logic, DB integration (duplicates, API CRUD/sorting/hidden/roles). UI checked in headless Chromium against the dev server. |
| 3 | **done** (2026-10-03, deployed `7b1f982`, review buttons `8efd100`; production `/api/health` ok, import routes answer 401 without a session): `@rekordy/core/fit` (separate entry point: `parseFit` on `@garmin/fitsdk`, timer-based stream with pauses / GPS jumps / missing distances handled, per-km splits with the partial km flagged and elevation per split, sport + trail + race detection, `garmin:<serial>:<time_created>` external ID, SHA-256 via Web Crypto), the best-effort engine in core (`fastestSegmentS`, `effortsFromStream`, `computeEfforts`; `recomputeEfforts` now handles stream activities), `POST /api/import/check` + `POST /api/import/fit` (multipart, server re-parse, stream gzip, raw file `storage/fit/<yyyy>/<sha256>.fit.gz`), **Import → Pliki FIT** (Dropzone for `.fit` and `.zip`, Web Worker unzip + parse, Garmin Connect link from `<id>_ACTIVITY.fit`, duplicate check, per-file review, approve all, summary), read-only activity detail `/activities/:id` (results + splits table/bar chart). Tests: core unit + synthetic FIT files (SDK encoder) + the user's 6 anonymised files (splits within 2 s of the watch's 1 km auto-laps), import API integration, web import state. UI checked in headless Chrome against the dev server (test DB). |
| 4 | **done** (2026-10-03, deployed `9267ec6` by the user; production `/api/health` ok with 4 migrations applied, `/api/records` answers 401 without a session): records API (`GET /api/records`: top 3 per distance by pace, hidden activities and deleted results excluded), result edit / soft delete / restore / reset of a manual edit, `jobs` table (migration `0003_jobs`) with the chunked, resumable recompute-all job (`/api/admin/*`, `node dist/tools.cjs recompute-all`), **Rekordy życiowe** view (sport tabs, one card per distance, medals, tolerance marker + tooltip that also opens on a tap, editor edit modal with a live pace preview, delete confirmation), **Administracja** page (recompute with progress / resume, deleted results with restore). DB sessions now run in UTC (TIMESTAMP fix). Tests: core engine scenarios, records / efforts / admin API integration, web form + job driver. UI checked in headless Chrome (desktop + 390 px phone, editor and viewer) against the dev server with the user's 6 FIT files imported. |
| 5 | **done** (2026-10-03, deployed `0531f48` by the user; production `/api/health` ok, `/api/events` answers 401 without a session and returns the list, ordering setting and suggestions for a viewer; the first push `3e80311` failed CI on MariaDB 11.4 JSON parsing, fixed in `0531f48`): events in core (name normalisation + token similarity for suggestions; aggregation: best pace, Q6 elevation, most common distance; Polish-collation ordering), events API (list with unassigned races, detail, create incl. from a race, rename / distance, merge, delete, manual order, suggestions) and `/api/settings/:key` (`events.ordering.<sport>`), event assignment on activities and in the FIT import (`eventId` / `newEventName`, reused by name), **Zawody** view (sport tabs, Ręczna / Nazwa toggle, accordion with columns, dnd-kit drag handles for the editor, editions with inline per-km splits + notes, editor dialogs), "Wydarzenie" picker with suggestions, "Utwórz nowe" and the rename question in the activity form, the FIT review and the edition dialog, event link on the activity page. Tests: core unit (normalisation, similarity, aggregation, ordering), events / settings / import API integration, web logic. UI checked in headless Chrome (desktop editor, 390 px phone as viewer and editor) against the dev server: the dragged order survives a reload, "Nazwa" sorts with Polish collation, editions show splits and notes. |
| 6–8 | not started |

### Decision log

| Date | Decision |
|---|---|
| 2026-09-30 | Plan created. Decisions D1–D6. |
| 2026-09-30 | D7 corrected: Seohost, SSH available, Node 22.23.2. Only the app process is started/restarted from the panel (Passenger). Self-contained bundle, deploy over SSH (rsync + migrations + restart), config in `.env`, maintenance CLI over SSH + selected admin buttons. |
| 2026-10-02 | Hosting verified over SSH. DirectAdmin + **CloudLinux Node.js Selector** confirmed (`cloudlinux-selector` CLI available, supports `restart`). Node 22 binary `/opt/alt/alt-nodejs22/root/usr/bin/node` (not on PATH). MariaDB **11.4** on the host. `rsync`, `tar`, `mysqldump` and cron are available. Existing apps live in `~/nodejsapp/<name>`. |
| 2026-10-02 | App root `~/nodejsapp/rekordy-sportowe` (selector app root `nodejsapp/rekordy-sportowe`), URL https://sport.kula.opole.pl (subdomain already exists). |
| 2026-10-02 | Local dev DB: XAMPP MariaDB **10.4.32** (`root`, no password; DBs `rekordy_sportowe`, `rekordy_sportowe_test`). Production is 11.4, so SQL must stay 10.4-compatible. CI uses a MariaDB 11.4 service container. |
| 2026-10-02 | Repo: GitHub `lgkula/rekordy-sportowe` + GitHub Actions (CI on push/PR; Deploy manual via `workflow_dispatch` with a dedicated SSH deploy key). |
| 2026-10-02 | Deploy transfer = `tar.gz` + `scp` + remote script over SSH (the local Windows machine has no `rsync`). Restart via `cloudlinux-selector restart` (panel mechanism), fallback `tmp/restart.txt`. Migrations run by the deploy script (`node dist/tools.cjs migrate`, MySQL `GET_LOCK`), never inside Passenger workers. `/api/health` returns 503 if migrations are pending. |
| 2026-10-02 | The deployed `package.json` must not have `"type": "module"`: otherwise `app.js` (CommonJS) fails with "require is not defined in ES module scope" (found while testing the spike). |
| 2026-10-02 | Tooling versions: TypeScript **6.0** (typescript-eslint does not support TS 7 yet), Vite 8, Vitest 5, React 19, Mantine 9, React Router 8, Fastify 5, Zod 4, Drizzle ORM 0.45. Server bundle ~4.4 MB (unminified, with source maps; `app.js` enables `process.setSourceMapsEnabled`). |
| 2026-10-02 | **Spike results** (app created in the panel: Node 22.23.2, Production, root `nodejsapp/rekordy-sportowe`, URL `sport.kula.opole.pl`, `app.js`):<br>• The web server is **LiteSpeed**; the Node runner is **`lsnode.js`**, which reads the Passenger directives from `.htaccess`. It overrides `listen()` (socket in `LSNODE_SOCKET`; `PORT` is not set). Fastify `listen({port})` works unchanged.<br>• cwd = app root; `NODE_ENV=production` from the panel; the app starts lazily on the first request.<br>• **Static files in `public_html` win over the app.** The Seohost placeholder `public_html/index.html` hid the app on `/`; renamed to `index.html.seohost-default`. Never put files into the subdomain's `public_html`.<br>• Restart: `cloudlinux-selector restart --json --interpreter nodejs --app-root nodejsapp/rekordy-sportowe` works (new pid).<br>• Logs: lsnode writes the app's **stderr** to `<app-root>/stderr.log`; stdout is discarded, so the Fastify logger writes to stderr. Rotation follows in Part 8.<br>• Request body: 60 MB uploads pass through LiteSpeed (no host limit below that).<br>• **Bot protection** on the host answers **429** to `curl`'s default User-Agent (Node `fetch` and custom UAs pass). Every HTTP client we write (deploy health check, Windows sync script) must send its own User-Agent. |
| 2026-10-02 | Production DB `srv34629_rekordy` (MariaDB 11.4). `.env` values with special characters must be quoted: an unquoted `#` in `DB_PASSWORD` truncated it (Node `util.parseEnv`, dotenv semantics), so the first deploy got "Access denied". Fixed by single-quoting; documented in WDROZENIE.md and `.env.example`. |
| 2026-10-02 | **Part 1 (auth):** session lifetime **96 h** without "remember" (browser-session cookie) and **90 days** with it, both **sliding** (cookie re-issued when older than 1 h). The viewer password is changed only via `.env` + `hash-secret` (no UI). Rate limit = own limiter in MariaDB (`auth_failures`, 10 failures / 15 min per IP, fixed window), counting **only failed** passwords/tokens and **not reset** by a success (so the known viewer password cannot be used to reset the counter); `@fastify/rate-limit` not used (its in-memory store is not Passenger-safe). `hash-secret` is interactive with hidden input (`ssh -t` on the host), `--write` edits `.env` in place. |
| 2026-10-02 | Auth implementation details: hashes `scrypt:N:r:p:salt:hash` (N=16384, r=8, p=1, Node `crypto.scrypt`); cookie `rs_session` = base64url JSON + HMAC-SHA256 (`SESSION_SECRET`), no server state. Default guards: matched `/api/*` routes need a session, non-GET need `editor`, `/api/agent/*` only the bearer token (cookies ignored there, token rejected elsewhere). Missing secrets: the app still starts (so `tools.cjs migrate` works), login answers 503 and `/api/health` 503 with `auth.configured: false`. `trustProxy` = trust only the immediate peer (Fastify 5 ignores a numeric hop count), so `request.ip` is the last X-Forwarded-For entry. Editor password ≥ 12 characters. |
| 2026-10-02 | Display formats: pace `m:ss` (+ ` /km`); duration `m:ss` below 1 h and `h:mm:ss` from 1 h; distance with a Polish decimal comma, no thousands grouping. |
| 2026-10-02 | **Part 2, Q2:** `duration_s` = timer time (auto-pause excluded); total time goes to `elapsed_s`. |
| 2026-10-02 | **Part 2, Q8** (activities without a stream, target T): `T ≤ d ≤ 1.01·T` counts as a full result with the time scaled to T (GPS margin; applies to 1 km too); `0.9·T ≤ d < T` and `1.01·T < d ≤ 1.1·T` give a **tolerance result** over the whole activity (average pace, time hidden, actual distance in the tooltip), only for T > 1 km; anything else gives no result. Implemented in `effortFromTotals` (core) and used by `recomputeEfforts` for every stream-less activity. |
| 2026-10-02 | **Part 2, simplified form:** fields sport, name, date, distance, record (distance key + time), optional whole-activity time, link. The record time covers the target when the activity is at least T long (`actual = T`, full result), or the whole activity when it is shorter (tolerance result; needs `d ≥ 0.9·T`, `d ≥ T` for 1 km). Without a whole-activity time, the server copies the record time when `d ≤ T`; otherwise `duration_s` stays NULL (shown as “—”). Source `manual_simple`, one `origin = manual` effort. |
| 2026-10-02 | **Part 2, activities list:** default sort date desc (name/distance default asc), server-side pagination 50 per page, sport tabs incl. “Wszystkie”; list state in the URL. Hidden activities stay in the list for everyone, greyed out. |
| 2026-10-02 | **Part 2, start time / fuzzy duplicates:** the start time is optional (full form; the simplified form has the date only), so `start_time_utc` is nullable. Fuzzy rule: distance within ±3% of the new activity and start within ±2 min, or the **same local date** when either start time is unknown. Fuzzy → 409 `similar_activity` until the client resends with `confirmDuplicate: true`; hard (`external_id` / `file_name` / `file_sha256`) → 409 `duplicate` always (also after a lost race on the UNIQUE indexes). Duplicates are checked on create only, not on PATCH. |
| 2026-10-02 | **Part 2, efforts:** `recomputeEfforts(activityId)` never touches efforts that are `manual`, `is_edited` or `is_deleted` (only their denormalised sport); a manual effort entered again replaces a soft-deleted one. Activities with a stream are left for the Part 4 engine. Event assignment in the form is deferred to Part 5 (only `event_id` exists now). |
| 2026-10-02 | **Part 2, validation:** shared Zod schemas in `packages/core` use **validation codes** as messages (`invalid_duration`, `effort_distance_too_short`, …); the web maps them to Polish text in `pl.validation`, so UI strings stay in `pl.ts`. MariaDB JSON is LONGTEXT, so JSON columns use a custom Drizzle type that parses strings; DECIMAL columns use `mode: 'number'`. |
| 2026-10-02 | **GitHub Actions deploy works.** Repository secrets `SSH_HOST`, `SSH_PORT`, `SSH_USER`, `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`; dedicated key `~/.ssh/rekordy_github_deploy` (comment `github-actions-rekordy`) in the host's `authorized_keys`. The key must have **no passphrase**: `ssh-keygen -N '""'` in PowerShell 7 sets the literal passphrase `""`, so WDROZENIE.md now generates the key interactively. First run deployed `8c0e2d6` in about 1 min. Workflows use `actions/checkout@v7` and `actions/setup-node@v7` (Node 24 runtime; v4 ran on the deprecated Node 20). |
| 2026-10-03 | **Part 3, Q1 (race detection):** the user's Fenix 7X files have no race-calendar or event field; races are recorded with a dedicated activity profile **"Bieg zawody"** (ordinary runs: "Bieg"), stored in `sport.name` / `session.sport_profile_name`. Rule: profile name matches `/zawod|race|wyścig/i` → `isRace = true`, `isRaceConfidence = 'fit'`; otherwise `false` / `'none'` (no heuristic; the review has a checkbox). |
| 2026-10-03 | **Part 3, sport detection:** all sample files are `running/generic`, including a mountain race. `trail_run` when `sub_sport = trail`, or the profile name matches `/trail|teren|przełaj|górsk/i`, or the average climb is **≥ 20 m/km** (the mountain race: 34 m/km, other runs 1–4 m/km); otherwise `road_run`. Shown with its source in the review and editable. **Treadmill / indoor runs** (`treadmill`, `indoorRunning`, `virtualActivity`) are **unsupported** (not imported). `crossCountrySkiing` → `xc_ski`. Multisport files are rejected. |
| 2026-10-03 | **Part 3, FIT normalisation:** totals come from the `session` message (Garmin Connect's numbers): distance, timer time (`duration_s`), elapsed time, total ascent. Local date / name from the activity's `local_timestamp` offset (fallback: timestamp correlation, then Europe/Warsaw). Default name = profile name + local date, e.g. "Bieg zawody 27.09.2026". Stream: `record` samples as recorded (1 s on training, "smart recording" 1–8 s in the race profile; not resampled), timer axis from `timer` start/stop events, samples without distance dropped, distance forced monotonic, steps faster than 12 m/s (25 m/s for skiing) cut down as GPS jumps. Splits: kilometre boundaries of the cumulative distance with linear interpolation, the last piece flagged `partial`; elevation per split from altitude with a 1 m hysteresis, scaled to add up to the session's total ascent. On the user's races the splits match the watch's 1 km auto-laps within 1 s. |
| 2026-10-03 | **Part 3, best efforts moved forward from Part 4:** `fastestSegmentS` (two-pointer sliding window, both window edges interpolated) + `effortsFromStream` (stream covers T → fastest segment; otherwise the Q8 totals rule, i.e. a tolerance result for `0.9·T ≤ d < T`) in core; used for the import preview and by `recomputeEfforts` for stream activities. Part 4 builds the records view and the recompute-all job on top of it. |
| 2026-10-03 | **Part 3, import flow:** files are parsed in a Web Worker (the Garmin SDK is a separate entry point `@rekordy/core/fit` and a separate chunk, ~440 kB). Duplicate check right after parsing: within the batch (a file dropped twice / renamed copy) and on the server (hard → "duplikat", fuzzy → "podobna aktywność", saving needs a checkbox). Each approved file is uploaded on its own (`meta` JSON + `file`, multipart, limit **10 MB** per file; the host passes 60 MB); "Zatwierdź wszystkie pozostałe" uploads the remaining files without an unconfirmed warning, one by one. The server re-parses the file and takes from the client only the review fields (name, sport, race, hidden, URL, notes, `editionLabel` placeholder; event assignment is Part 5). The raw file is stored before the DB insert (content-addressed, so a repeat is a no-op). The activity URL cannot be derived from a FIT file: entered by hand (or from the bulk import later). |
| 2026-10-03 | **Part 3, test fixtures:** the user's sample files are committed only as anonymised copies in `packages/core/test/fixtures/` (`scripts/anonymize-fit.mjs`: re-encoded with the SDK, keeping file_id/sport/session/lap/activity/timer events/record time-distance-altitude-speed; GPS, heart rate, device and user data dropped; serial number replaced). The originals are not committed. |
| 2026-10-03 | **Part 3, ZIP archives / Garmin Connect link:** Garmin Connect's "export original" is `<activityId>.zip` containing `<activityId>_ACTIVITY.fit` (checked on the user's download). The FIT import accepts `.zip` (up to 50 MB) and unpacks it in the Web Worker with **fflate**: every `.fit` inside (any folder; `__MACOSX` / dot files skipped) becomes its own item ("z archiwum …"); FIT files over 10 MB are not inflated (size from the central directory); a damaged archive or one without FIT files is an error item. The server receives the extracted `.fit`, so file name / hash duplicates use the inner file. A file named `<digits>_ACTIVITY.fit` pre-fills the link **`https://connect.garmin.com/app/activity/<id>`** (the user's URL format; `/modern/activity/` is the old one), editable in the review. |
| 2026-10-03 | **Part 4, Q3:** at most **one result per activity per distance** (its fastest segment), as the schema already enforces (`UNIQUE(activity_id, distance_key)`). |
| 2026-10-03 | **Part 4, activity edits:** editing an activity recomputes only its `computed` results; results edited by hand, entered by hand (simplified form) or deleted keep their values (only their denormalised sport follows the activity). Unchanged from Part 2. |
| 2026-10-03 | **Part 4, editing a result:** the editor changes the time and/or the actual distance, and the activity link (stored on the activity). New values go through the totals rule (Q8, `editedEffort`): exactly T, or up to +1% with the time scaled to T → full result; `0.9·T ≤ d < T` or up to +10% → tolerance result (targets > 1 km only); anything else is rejected (`effort_distance_out_of_range`). Changing the time / distance sets `is_edited`; changing only the link does not. **"Przywróć wartość obliczoną"** (`POST /api/efforts/:id/reset`) clears `is_edited` of a computed result and recomputes it; hand-entered results have nothing to go back to (409). |
| 2026-10-03 | **Part 4, deleted results:** soft delete, listed on the **Administracja** page (filter by sport) with **"Przywróć"**. Restoring an unedited computed result recomputes it, so it may disappear if the activity no longer qualifies under the current rules (the UI says so). |
| 2026-10-03 | **Part 4, ranking:** pace ascending; ties by earlier `local_date`, then start time, then effort id. One query per distance (`LIMIT 3`, index `efforts_records_idx`), no window functions. The API returns `durationS: null` for tolerance results (D2); the edit form derives their time from pace × distance. |
| 2026-10-03 | **Part 4, recompute-all job (Passenger-safe):** nothing runs in the background. A `jobs` row (type, status `running`/`done`, `cursor_id` = last activity id, processed/total, error lines, lease) advances by **one chunk per request** (`POST /api/admin/jobs/:id/run`, ≤ 5 s / 200 activities); the Administracja page calls it in a loop. Each activity's efforts and the job progress are committed in one transaction. A chunk takes a **60 s lease** (`lease_until_ms`): parallel requests or processes never run the same job at once (`busy: true`, the client retries after 2 s), and a lease left by a killed process expires. At most one running job per type (`UNIQUE active_key`). A failing activity is recorded in `error` and skipped. The SSH command `recompute-all` drives the same job (30 s chunks) and resumes an interrupted one. |
| 2026-10-03 | **DB session time zone = UTC.** Found in Part 4: the local MariaDB session ran in `SYSTEM` (Europe/Warsaw) while mysql2 converts TIMESTAMPs as UTC (`timezone: 'Z'`), so `DEFAULT now()` values read back 2 h late and `Date`s written from JS were stored 2 h early. Every pool connection now runs `SET time_zone = '+00:00'`. DATETIME columns such as `start_time_utc` are not affected; TIMESTAMP data is stored in UTC internally, so existing rows now read correctly. The host's system zone is unknown, so the fix applies there too. |
| 2026-10-03 | **Part 4, records UI:** default page `/records`, sport in `?sport=`; one card per distance with results; 🥇🥈🥉 / Tempo / Czas / Data / Aktywność (link to the detail page + ↗ to Garmin/Strava). Tolerance results are muted with "*", time "—", tooltip "Dystans: 4,60 km". Mantine's Tooltip does not open on a tap, so `TapTooltip` (controlled: mouse-only pointer hover, focus, click) is used here and in the activity's results table. On a phone the date moves under the activity name. Edited results show a ✎ to the editor. |
| 2026-10-03 | **Deploy health check checks the version.** On the `8efd100` deploy, `/api/health` was still answered by the old process (`7b1f982`, uptime 815 s) right after a successful `cloudlinux-selector restart`, and the script reported "Deploy OK". `scripts/deploy.mjs` now reads `<version>+<commit>` from the artifact's `build-info.json` and succeeds only when `/api/health` is ok **and** reports that version (polls every 3 s, fails after 90 s). Verified on the `c55b70c` deploy. Applies to local and GitHub Actions deploys. |
| 2026-10-03 | **Part 5, Q6 / Q9 and aggregation:** the trail list shows the elevation gain of the **best-pace edition**. The event distance is **computed** (editions within ±3% of each other form a group; the largest group wins, on a tie the one with the newest edition; its median rounded to 10 m) **with a manual override** (`display_distance_m`; empty = computed again). Best pace = activity totals (`duration_s / distance_m`) over **all editions**, whatever their distance (on a tie the earlier edition). **Hidden** race activities are shown greyed out ("ukryta") but count for neither the pace, the elevation nor the distance. |
| 2026-10-03 | **Part 5, assignment rules:** an event belongs to one sport; an activity can join only an event of its sport (`event_not_for_sport`; the forms clear the event when the sport changes). Assigning an event marks the activity as a race; un-marking the race (without an event in the same request) removes it from its event. "Utwórz nowe" sends `newEventName`: the server creates the event in the same transaction as the activity, or **reuses** an event of the sport with the same name (case, diacritics and spacing ignored), so approving several files of one race creates it once and a skipped file leaves no empty event. Deleting an event keeps its activities (FK `SET NULL`); merging moves the editions into the target and deletes the source (same sport only). New events go to the end of the manual order. |
| 2026-10-03 | **Part 5, races without an event** are listed as **one-edition events** of their own (key `a<activity id>`, no row in `events`): last in the manual order (newest first, no drag handle), mixed in alphabetically when sorted by name. The editor can turn one into an event ("Utwórz wydarzenie", name editable) or assign it to an existing event. |
| 2026-10-03 | **Part 5, ordering:** setting `events.ordering.<sport>` (`manual` by default, or `name`), saved by the editor; a viewer may switch it for themselves (not saved). Manual order = `events.sort_order`, saved on drop (`PUT /api/events/order`, optimistic update). "Nazwa" sorts with `Intl.Collator('pl')` in shared core code, not with a MySQL collation (the tables use the server default charset). Checked over SSH that the host's Node 22 has full ICU with Polish ("Lublin" < "Łódź" < "Sobótka" < "Śnieżka"). `settings.value` is now read with the MariaDB-safe JSON column type (no DDL change, no migration). |
| 2026-10-03 | **Part 5, suggestions:** names become tokens: lowercase, Polish letters folded, dates / years / bare numbers / ordinals ("15.") / Roman numerals dropped, "edycja" and filler words dropped, "bieg" / "zawody" kept only when nothing more specific is left, distances kept as one token ("10km"). Two tokens match by a shared stem (≥ 4 letters and ≥ 70% of the longer one, for Polish inflection) or by at most one edit per 5 letters; the name score pairs every token with its best match in both directions. Suggested from a score of 0.5, top 5. The default watch name ("Bieg zawody 27.09.2026") suggests nothing, so the picker suggests from the name as the user types it. Choosing an event asks whether to rename the activity to the event name (Zmień / Zostaw). |
| 2026-10-03 | **Part 5, races UI:** `/races` is a lazy chunk (with dnd-kit); sport in `?sport=`, the open event in `?event=` (the activity page links there). Columns Nazwa / Dystans / Najlepsze tempo (+ the edition it comes from) / Przewyższenie (trail) / Edycje; on a phone one summary line instead. Editions expand **inline** (user's choice) into notes, per-km splits (`SplitsView`) and links; on a phone the date moves under the edition label. Editor actions sit inside the expanded panel (no buttons nested in the accordion control). |
| 2026-10-03 | **JSON columns are read as raw strings** (mysql2 `jsonStrings: true`). Found by CI on Part 5: MariaDB ≥ 10.5 (CI and production 11.4) marks JSON columns in its extended metadata and mysql2 then parses them itself, while the local 10.4 sends plain text. A JSON string value (the setting `"name"`) arrived already parsed and `jsonText` parsed it again (500 on `/api/events`). With raw strings both versions behave the same and `jsonText` always parses. |

---

## Podsumowanie po polsku

**Co budujemy:** prywatną aplikację webową z rekordami sportowymi. Ma trzy widoki:

- **Rekordy życiowe** — top 3 wyniki na każdym dystansie, osobno dla biegów i biegów przełajowych.
- **Zawody** — kolejne edycje tego samego biegu zgrupowane w jedno wydarzenie, z tempami na kilometrach i notatkami.
- **Aktywności** — edycja, usuwanie, tryb ukryty, wykrywanie duplikatów.

Dane trafiają do aplikacji na cztery sposoby: ręczny formularz (pełny i uproszczony), import plików FIT, import eksportu zbiorczego ze Stravy / Garmin Connect oraz skrypt Windows, który po podłączeniu zegarka wysyła nowe pliki FIT.

**Technologie** (dobrane pod hosting współdzielony z Node.js i MySQL, bez Dockera):

- całość w **TypeScript**
- frontend: **React + Vite + Mantine** (gotowe komponenty, tooltipy, drag & drop)
- backend: **Fastify**
- baza: **MySQL + Drizzle ORM** (lekki, bez natywnych modułów)
- pliki FIT: oficjalny **Garmin FIT SDK** (JavaScript)
- skrypt: **PowerShell** z obsługą **MTP**, bo Fenix 7X nie ma litery dysku.

**Hosting Seohost:** Node.js 22, dostęp przez SSH. Proces aplikacji uruchamia wyłącznie panel (moduł Node.js działający przez Passenger). Dlatego:

- w panelu tworzysz aplikację:
  - wersja Node **22**, tryb **Production**
  - katalog główny poza `public_html`
  - plik startowy **`app.js`**
- Passenger sam przejmuje port, więc aplikacja słucha na `process.env.PORT` i nie ma portu wpisanego na sztywno. Część 0 zaczyna od małej aplikacji testowej, żeby to potwierdzić.
- serwer jest budowany lokalnie do jednego pliku ze wszystkimi bibliotekami w środku, więc na serwerze nie trzeba `npm install` ani `node_modules`
- wdrożenie to jedna komenda na Twoim komputerze: budowanie → wysłanie przez `rsync`/SSH → migracje bazy przez SSH → restart aplikacji (`tmp/restart.txt` albo przycisk w panelu) → sprawdzenie `/api/health`
- konfiguracja i hasła są w pliku `.env` w katalogu aplikacji, bo z niego korzystają zarówno aplikacja, jak i skrypty uruchamiane przez SSH
- zadania serwisowe (przeliczenie rekordów, kopia zapasowa, hashe haseł) to polecenia uruchamiane przez SSH. Część z nich ma też przyciski na stronie „Administracja”.
- Passenger może zatrzymać nieużywaną aplikację, więc nic ważnego nie może żyć tylko w pamięci procesu.

Logika rekordów i parsowanie plików są we wspólnym pakiecie, który działa i w przeglądarce, i na serwerze. Dzięki temu duże eksporty zbiorcze są rozpakowywane w przeglądarce i nie obciążają hostingu.

**Najważniejsze reguły:**

- Ranking rekordów jest zawsze wg tempa.
- Dla dystansów powyżej 1 km obowiązuje tolerancja 10% (np. 4,6 km liczy się jako 5 km). Taki wynik jest oznaczony, nie pokazuje czasu, a po najechaniu tooltip podaje faktyczny dystans.
- Z dłuższej aktywności liczony jest najszybszy odcinek (np. 5 km w ramach 10 km).
- Wyniki z ukrytych aktywności nie trafiają do rekordów.
- Każdy wynik rekordu można edytować lub usunąć; wtedy na jego miejsce wskakuje następny.

**Dostęp:**

- Hasło `lk` daje rolę przeglądającego, silne hasło daje rolę edytora.
- Rolę można przełączać.
- Checkbox „zapamiętaj” zapisuje rolę w przeglądarce na 90 dni.
- Skrypt Windows ma osobny token z uprawnieniem tylko do wysyłania plików.

**Podział na 9 części** (każda z osobnym promptem w [docs/prompts/](prompts/README.md)):

0. szkielet projektu i pierwsze wdrożenie na hosting (najpierw sprawdzamy, czy hosting działa)
1. logowanie i role
2. model danych, lista aktywności, formularze ręczne
3. import plików FIT
4. silnik rekordów i widok rekordów
5. widok zawodów
6. import zbiorczy Strava / Garmin
7. skrypt Windows
8. testy, kopie zapasowe, dokumentacja.

**Otwarte pytania** (tabela w sekcji 10) zadam po polsku na początku odpowiedniej części. Najważniejsze:

- jak oznaczasz zawody na zegarku (potrzebne przykładowe pliki FIT)
- czas „timer” czy czas całkowity
- czy pliki ze skryptu zatwierdzasz ręcznie
- brakujące szczegóły Seohost: ścieżka katalogu aplikacji, domena lub subdomena, ścieżka do Node 22 przez SSH, sposób restartu, gdzie są logi, cron, wersja MySQL/MariaDB.
