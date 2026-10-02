# Part 8 — Hardening & release

## Podsumowanie (PL)

- Końcowe utwardzenie aplikacji:
  - testy end-to-end (logowanie, rekordy, zawody, import, uprawnienia)
  - kopia zapasowa bazy i plików FIT: skrypt uruchamiany przez SSH i cron, z rotacją kopii i instrukcją przywracania
  - strony błędów po polsku
  - nagłówki bezpieczeństwa
  - przegląd wydajności i działania na telefonie.
- Na koniec powstaje instrukcja użytkownika po polsku, instrukcja wdrożenia i aktualizacji, a aplikacja jest wdrażana na hosting.
- Zapyta, gdzie i jak często robić kopie zapasowe.

## Prompt

```
You are implementing Part 8 of the "rekordy-sportowe" project: hardening, backups, documentation and the final release.

## Working rules (apply to the whole session)
- Read docs/PLAN.md fully and CLAUDE.md before doing anything. Review the Status table and the Decision log. Report to me (in Polish) any gaps between the plan and what is implemented before fixing them.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings and the user guide are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Questions to ask me first (in Polish)
- Backups: how often, how many to keep, and where (on the host only, or also downloaded to my PC by the Windows script / a scheduled download)? Is cron available on Seohost (via `crontab` over SSH or in the panel)?
- Is there anything from the previous parts I want changed before release?

## Scope
1. E2E smoke tests (Playwright) against a local build with a seeded test DB:
   - viewer login (`lk`): records visible, no edit controls
   - editor login + remember-me; role switch
   - FIT import of a fixture → the activity appears → records updated → hide it → records updated
   - races view expand/collapse + manual ordering
   - the agent endpoint rejects a missing or invalid token.
2. Security review:
   - all mutating routes require editor
   - input validation everywhere
   - headers via `@fastify/helmet` (CSP compatible with the SPA)
   - upload limits
   - no secrets in the repo
   - raw FIT storage not publicly reachable
   - dependency audit.
3. Error handling: global error handler with Polish user-facing messages, a React error boundary, a 404 page, a toast notification for API errors, structured server logs (pino) with rotation suitable for shared hosting.
4. Backups (SSH + cron allowed, D7):
   - `node dist/tools.cjs backup`: a DB dump (`mysqldump` if available on Seohost, otherwise a Node-based dump through `mysql2`) + an archive of `storage/fit`, with retention, stored outside the web root
   - a cron entry (crontab over SSH or the panel's cron) + instructions
   - `node dist/tools.cjs restore <file>` with a confirmation prompt; restore tested at least once locally
   - optionally a local script (`npm run backup:pull`) that downloads the latest backups to my PC over SSH (ask me)
   - mention Seohost's own backups as an extra layer.
5. Performance and UX:
   - check query plans for the records/events endpoints
   - lazy-load the import pages (code splitting)
   - check the mobile layout of all views
   - a Lighthouse pass.
6. Documentation:
   - `docs/DEPLOYMENT.md` (final, English)
   - `docs/PODRECZNIK.md`: a Polish user guide covering login and roles, adding activities (full/simplified), FIT import, bulk import, the Windows script, hidden mode, editing records, the races view
   - update `README.md`.
7. Release:
   - version tag `v1.0.0`, a CHANGELOG
   - `npm run deploy` (build → rsync → migrations over SSH → restart via the Passenger method from Part 0 → health check) → `node dist/tools.cjs recompute-all` over SSH (or the Administracja button) → verify `/api/health`.
   - Check that `docs/WDROZENIE.md` / `docs/DEPLOYMENT.md` never tell me to start the Node process by hand. The process is started only by the Seohost panel/Passenger.
   - Ask before pushing, tagging or deploying.

## Acceptance criteria
- All unit, integration and E2E tests pass. The production deployment works with real data.
- A backup can be created and restored. The user guide covers every feature from docs/PLAN.md.
```
