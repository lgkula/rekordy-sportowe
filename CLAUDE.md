# CLAUDE.md

Personal sports records web app (running, trail running; cross-country skiing later).
**Source of truth: [docs/PLAN.md](docs/PLAN.md)**: stack, domain rules, data model, API, open questions, decision log.
Implementation is split into parts; each has a prompt in [docs/prompts/](docs/prompts/README.md).

## Working rules

- Communicate with the user in **Polish**. All clarifying questions are in Polish (AskUserQuestion for discrete choices).
- Code, identifiers, comments, commit messages and technical docs are in **English**. All UI strings are **Polish** and live in `apps/web/src/i18n/pl.ts`.
- When something is ambiguous or not covered by PLAN.md, **ask** instead of guessing. Before implementing a part, present a short plan in Polish and wait for answers.
- Before finishing: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build` must pass. Then update the Status table and the Decision log in PLAN.md.
- Ask before committing, pushing or deploying.
- API access (Part 1): every `/api/*` route needs a session by default; non-GET routes need `editor`; `/api/agent/*` needs the agent bearer token. Public routes set `config: { access: 'public' }`. On the web, hide editor-only controls with `useCanEdit()`.

## Hosting rules (PLAN.md D7, section 3.2)

- **Never delete anything on the hosting server without the user's double confirmation.** This covers files and directories (over SSH, scp/rsync with delete options, the panel), cron jobs, Node.js selector apps, subdomains, mail accounts and any other panel configuration. Double confirmation = (1) ask and get a "yes", then (2) list exactly what will be deleted (full paths / object names) and ask again, getting a second explicit "yes". A confirmation applies only to that one operation; no general or earlier approval counts. Exceptions:
  - `scripts/deploy-remote.sh` removing its own temporary staging directory and the uploaded archive after a deploy (the deploy itself still needs the user's approval).
  - The application's database: for now any operation is allowed (including `DROP`, `TRUNCATE`, `DELETE`, destructive migrations), until the user revokes this exception. Other databases on the account are not covered.
- Seohost shared hosting, DirectAdmin + **CloudLinux Node.js Selector**, **Node.js 22**, MariaDB 11.4. SSH alias `seohost`.
- **The Node process is started/restarted only by the panel's Node.js selector** (panel UI, or `cloudlinux-selector restart` in the deploy script). Never start or keep the server alive by hand (`node server.js &`, pm2, nohup, forever).
- SSH is fine for everything else: migrations, maintenance CLI (`node dist/tools.cjs <command>`), cron.
- Passenger-safe code: port from `process.env.PORT` (Passenger overrides `listen()`), no critical in-memory state or in-process timers (processes may stop when idle or run in parallel), long jobs chunked and resumable.
- The server is bundled into **self-contained** `dist/server.cjs` / `dist/tools.cjs` (all dependencies inlined, no native modules): the host has no `node_modules`.
- The deployed `package.json` must **not** contain `"type": "module"`, because `app.js` is CommonJS.
- Host Node binary: `/opt/alt/alt-nodejs22/root/usr/bin/node`. App root: `~/nodejsapp/rekordy-sportowe`. URL: https://sport.kula.opole.pl. Config: `<app-root>/.env` (chmod 600).
- The web server is **LiteSpeed**; the Node runner is `lsnode.js` (Passenger-compatible, it overrides `listen()`). App logs = **stderr** → `<app-root>/stderr.log` (stdout is discarded), so log to stderr.
- Files in the subdomain's `public_html` are served before the app: keep it empty of `index.html` etc.
- The host's bot protection answers **429** to curl's default User-Agent: every HTTP client we write (deploy health check, Windows sync script) sends its own User-Agent.
- Local DB is XAMPP MariaDB **10.4**, production is **11.4**: do not use SQL features newer than 10.4 (e.g. `RETURNING`, `UUID` type).

## Layout

```
apps/server     Fastify API + serves the SPA; Drizzle (MySQL/MariaDB); tsup bundle -> dist/*.cjs
  src/server.ts   production entry (loaded by deploy/app.js under Passenger)
  src/tools.ts    maintenance CLI (migrate, ...)
  drizzle/        generated SQL migrations (shipped in the artifact)
  deploy/app.js   Passenger startup file (CommonJS)
apps/web        React + Vite + Mantine SPA (Polish UI)
packages/core   shared domain logic (browser + Node, no Node-only APIs); FIT parser in src/fit
                (entry `@rekordy/core/fit`), anonymised FIT fixtures in test/fixtures
scripts/        package.mjs (artifact), deploy.mjs + deploy-remote.sh (deploy over SSH),
                anonymize-fit.mjs (FIT test fixtures without GPS / HR)
spikes/         throwaway experiments (passenger-hello)
docs/           PLAN.md, prompts, DEPLOYMENT.md (EN), WDROZENIE.md (PL)
```

## Commands

```
npm run dev                 # Fastify :3000 + Vite :5173 (proxy /api)
npm test                    # Vitest (DB integration tests use TEST_DB_NAME, skipped if unset)
npm run lint | typecheck | format | format:check
npm run db:generate         # drizzle-kit: SQL migration from schema changes (apps/server/src/db/schema.ts)
npm run db:migrate          # apply migrations to the local DB (apps/server/.env)
npm run hash-secret -- --write  # generate password hashes / agent token / session secret into apps/server/.env
npm run build               # web + server bundles
npm run package             # deploy/rekordy-sportowe.tar.gz
npm run deploy              # package -> scp -> migrate -> selector restart -> health check
```

Local config: `apps/server/.env` (see `apps/server/.env.example`). Local DB: XAMPP MariaDB, `root` without password, databases `rekordy_sportowe` and `rekordy_sportowe_test`.
