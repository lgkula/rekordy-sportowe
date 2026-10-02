# Part 0 — Scaffold & deployment skeleton

## Podsumowanie (PL)

- **Najpierw test hostingu.** Powstaje mała aplikacja testowa Fastify, którą uruchamiasz na Seohost z panelu (Node 22, tryb Production, plik startowy `app.js`). Sprawdza, czy Passenger poprawnie przejmuje port, jak działa restart i gdzie są logi. Dopiero potem budujemy właściwy projekt.
- Szkielet projektu: monorepo npm z trzema pakietami (`apps/web` React + Vite + Mantine, `apps/server` Fastify, `packages/core` wspólna logika).
- MySQL przez Drizzle, pierwsza migracja i endpoint `/api/health`.
- Serwer budowany do jednego pliku ze wszystkimi bibliotekami, więc na serwerze nie trzeba `npm install`.
- Skrypt wdrożenia uruchamiany na Twoim komputerze:
  - budowanie
  - wysłanie plików przez `rsync`/SSH
  - migracje przez SSH
  - restart aplikacji
  - sprawdzenie `/api/health`.
- Konfiguracja w pliku `.env` w katalogu aplikacji.
- Instrukcja po polsku, co ustawić w panelu Seohost.
- Dodaje `CLAUDE.md` ze stałymi zasadami pracy (pytania po polsku, zasady hostingu).
- Na początku zapyta o brakujące szczegóły: katalog aplikacji, domenę, ścieżkę do Node 22 przez SSH, sposób restartu, logi, cron, wersję MySQL.

## Prompt

```
You are implementing Part 0 of the "rekordy-sportowe" project: the scaffold and deployment skeleton.

## Working rules (apply to the whole session)
- Read docs/PLAN.md fully before doing anything. It is the source of truth (stack, domain rules, data model, API, and especially section 3.2 about hosting).
- Communicate with me in POLISH. All clarifying questions must be in Polish (use the AskUserQuestion tool when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or a decision is not covered by PLAN.md, ASK ME (in Polish) instead of guessing. Do not continue past a blocking doubt.
- Before writing code, give me a short implementation plan for this part in Polish, list your open questions, and wait for my answers.
- At the end: run lint + tests + build, update the "Status" table and "Decision log" in docs/PLAN.md, and give me a short summary in Polish (what was done, how to verify it, what is left).

## What is already known about the hosting
- Provider: Seohost. SSH available. Node.js v22.23.2 available.
- The panel's "Node.js → Utwórz aplikację" form has these fields: Wersja Node.js (default 10.24.1, must be changed to 22.x), Tryb aplikacji (Development/Production → NODE_ENV), Katalog główny aplikacji (physical app root; "upload app files here"), URL aplikacji (domain dropdown + path), Plik startowy aplikacji, Environment variables (add variable).
- This looks like the CloudLinux Node.js Selector (Passenger-based, `node_modules` as a symlink to a panel-managed virtual env), but verify it. Do not assume.

## Questions to ask me first (in Polish), in addition to your own
- Which domain/subdomain and URL path the app should use, and which app root directory (recommend one outside `public_html`, e.g. `~/apps/rekordy-sportowe`).
- The SSH host/user/port (I will configure key-based login myself; never store passwords in the repo).
- Ask me to run a few diagnostic commands over SSH and paste the output, e.g. `which node; node -v; ls ~/nodevenv 2>/dev/null; which cloudlinux-selector; mysql --version; crontab -l`. Also ask for the "enter the virtual environment" command the panel shows after the app is created (if any). Use the answers to decide how the Node 22 binary is invoked over SSH and how the app is restarted.
- Where the panel shows the application logs (if anywhere).
- MySQL or MariaDB, and which version. DB name/user will be in `.env` (never commit secrets).
- Local development database without Docker: local MariaDB/MySQL install, XAMPP, or a separate dev DB on the hosting?
- GitHub repo + GitHub Actions, or local scripts only?

## Scope
1. **Passenger spike first** (`spikes/passenger-hello/`):
   - a minimal Fastify app bundled into one CJS file + `app.js`, listening on `process.env.PORT`
   - it reports `process.version`, `NODE_ENV`, `process.env.PORT`, pid, uptime and cwd
   - a step-by-step Polish guide for me: create the app in the panel with the spike, upload it, open the URL.
   - Use it to verify: Passenger's `listen()` override works with Fastify; restart by `touch tmp/restart.txt` and/or the selector CLI; where logs go; whether ESM would work (we use CJS anyway); request body size limits (try a ~20 MB upload).
   - Record the findings in the PLAN.md decision log. If anything contradicts PLAN.md section 3.2, stop and ask me.
2. npm workspaces monorepo:
   - `apps/web`: React + Vite + TypeScript + Mantine (Polish locale, dayjs `pl`), React Router, TanStack Query. A simple layout with a header and navigation placeholders for: Rekordy, Zawody, Aktywności, Import.
   - `apps/server`: Fastify + TypeScript, Zod type provider, serves the built SPA (with history fallback) and `/api/*`. It listens on `process.env.PORT` (fallback 3000 for local dev), with graceful shutdown on SIGTERM/SIGINT.
   - `packages/core`: shared TS library (initially: formatting helpers for pace `m:ss /km`, time `h:mm:ss`, distance with a Polish decimal comma, plus tests). It must run in both the browser and Node (no Node-only APIs).
   - `engines.node` = `>=22 <23`. Local development on Node 22 as well (`.nvmrc`).
3. TypeScript strict, ESLint + Prettier, Vitest configured in all workspaces, root scripts: `dev`, `build`, `test`, `lint`, `typecheck`.
4. Drizzle ORM + drizzle-kit with the `mysql2` driver.
   - Config is loaded from `<app-root>/.env` (with panel/env vars overriding it). Provide `.env.example`.
   - First migration: a `settings` table only (the rest of the schema comes in Part 2).
   - Migrations run with `node dist/tools.cjs migrate` (over SSH, from the deploy script); locally with `npm run db:migrate`.
   - At startup the server checks for pending migrations. If any are pending, it logs an error and `/api/health` reports it. It does NOT migrate inside Passenger workers.
5. Server bundling with tsup/esbuild:
   - `dist/server.cjs` and `dist/tools.cjs`, with all runtime dependencies inlined, so the host needs no `node_modules` and no `npm install`
   - no native modules
   - the startup file `app.js` (CommonJS) requires `dist/server.cjs`
   - verify the artifact by running it locally from an empty folder containing only the deploy artifact.
6. Deploy script `npm run deploy` (runs locally; Node script or bash usable from Git Bash on Windows):
   1. build + package
   2. `rsync` (or `scp` if rsync is unavailable on my Windows machine; ask) into the app root, excluding `.env` and `storage/`
   3. `ssh` → migrations with the Node 22 binary
   4. restart (the method verified in the spike)
   5. poll `GET /api/health` until OK.
7. `GET /api/health` returns: app version (git sha), Node version, DB connectivity, pending migration count, and whether `storage/` is writable.
8. Docs:
   - `docs/DEPLOYMENT.md` (English, technical)
   - `docs/WDROZENIE.md` (Polish checklist): first-time setup in the Seohost panel (create the DB, create the Node.js app with Node 22 / Production / app root / URL / `app.js`, create `.env` over SSH with chmod 600), the first deploy, and every later update.
9. Create `CLAUDE.md` in the repo root with the permanent working rules above (Polish communication and questions, English code, Polish UI, ask when in doubt, PLAN.md as source of truth, run tests before finishing, **the hosting rules from D7**: the app process is started only by the panel/Passenger, SSH is fine for everything else, Passenger-safe code), plus the repo layout and main commands.
10. Initialise git with a sensible `.gitignore` (node_modules, dist, .env, storage/, deploy artifacts) if the repo is not a git repository yet. Ask before the first commit.

## Acceptance criteria
- The spike runs on Seohost when started from the panel, and the findings are recorded.
- `npm run dev` starts web + server locally. The page shows the layout, and `/api/health` reports DB OK.
- `npm run build` produces the web static files and the server bundle. `npm test` and `npm run lint` pass.
- The packaged artifact starts with `PORT=3000 node app.js` from an empty folder, with no `node_modules`.
- `npm run deploy` uploads, migrates and restarts the app on Seohost, and `/api/health` returns OK there.
```
