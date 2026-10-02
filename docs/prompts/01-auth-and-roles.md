# Part 1 — Auth & roles

## Podsumowanie (PL)

- Logowanie jednym polem hasła: `lk` daje rolę **przeglądającego**, silne hasło daje rolę **edytora**.
- Przełącznik ról w nagłówku: przejście na edytora wymaga hasła, powrót na przeglądającego nie.
- Checkbox „Zapamiętaj w tej przeglądarce”: ciasteczko na 90 dni zamiast sesyjnego.
- Serwer zawsze sprawdza uprawnienia, a próby logowania mają limit.
- Dodatkowo token API dla skryptu Windows, uprawniony tylko do wysyłania plików.
- Polecenie generujące hashe haseł i token, uruchamiane lokalnie albo przez SSH na serwerze. Wynik trafia do pliku `.env` aplikacji.

## Prompt

```
You are implementing Part 1 of the "rekordy-sportowe" project: authentication and roles.

## Working rules (apply to the whole session)
- Read docs/PLAN.md (especially section 4.5 "Access and roles") and CLAUDE.md before doing anything.
- Communicate with me in POLISH. All clarifying questions must be in Polish (use AskUserQuestion when choices are discrete).
- Code, identifiers, comments, commit messages and technical docs are in English. All UI strings are in Polish.
- HOSTING (PLAN.md D7, section 3.2): Seohost shared hosting, Node.js 22, SSH/terminal available (npm, migrations, maintenance scripts, cron may run over SSH). The ONLY restriction: the Node.js app process is started and restarted exclusively by the panel's Node.js app manager (Phusion Passenger, startup file `app.js`). Never propose starting or keeping the server alive by hand (no `node server.js &`, pm2, forever, nohup). Code must be Passenger-safe: listen on `process.env.PORT`, no hard-coded port, no critical in-memory state or in-process timers (processes may be stopped when idle or run in parallel), long jobs chunked and resumable.
- Whenever something is ambiguous or not covered by PLAN.md, ASK ME (in Polish) instead of guessing.
- Before writing code, give me a short implementation plan in Polish, list open questions, and wait for my answers.
- At the end: lint + tests + build, update "Status" and "Decision log" in docs/PLAN.md, and give a short summary in Polish.

## Scope
1. Roles: `viewer`, `editor`, `agent`.
   - Viewer password: default `lk`, stored as a scrypt hash in env (`VIEWER_PASSWORD_HASH`).
   - Editor password: strong, stored as a scrypt hash in env (`EDITOR_PASSWORD_HASH`).
   - Agent: bearer token, stored as a hash in env (`AGENT_TOKEN_HASH`), allowed ONLY on `/api/agent/*`.
2. Use Node's built-in `crypto.scrypt` + `timingSafeEqual` (no native deps). Add a `hash-secret` command to `dist/tools.cjs` (and `npm run hash-secret` locally) that generates the hashes and a random agent token. It can run locally or over SSH on the host, and can optionally write the values straight into `<app-root>/.env`. After changing `.env`, the app must be restarted (the method from Part 0). Document this in `docs/WDROZENIE.md`.
3. Session: stateless, HMAC-signed httpOnly cookie (`@fastify/cookie`) carrying `{role, exp, secretVersion}`. Flags: `Secure` in production, `SameSite=Strict`, `Path=/`.
   - `remember=true` → persistent cookie (90 days).
   - `remember=false` → session cookie (server-side expiry 12 h).
   - Bumping `SESSION_SECRET_VERSION` invalidates all sessions.
4. Endpoints:
   - `POST /api/auth/login {password, remember}` → the role is decided by which hash matches.
   - `POST /api/auth/logout`
   - `GET /api/auth/me`
   - `POST /api/auth/switch {targetRole, password?}`: editor→viewer needs no password, viewer→editor requires the editor password. `remember` is kept as it was.
5. Fastify hooks / decorators: `requireRole('viewer' | 'editor')`, `requireAgent`. By default every `/api/*` route except login/health requires at least viewer. Every mutating route requires editor.
6. Rate limit on login and switch (`@fastify/rate-limit`, e.g. 10 attempts / 15 min per IP). Generic error messages in Polish.
7. Frontend:
   - login page (one password field + checkbox "Zapamiętaj w tej przeglądarce")
   - auth context via `/api/auth/me`
   - route guard that redirects to `/login`
   - header with the current role badge ("Przeglądanie" / "Edycja"), a role switch (modal asking for the editor password) and logout
   - a `useCanEdit()` helper that hides editor-only controls.
8. Tests:
   - unit tests for hashing and cookie signing/verification (tampering, expiry, secret version)
   - integration tests for all auth endpoints and the role guards (viewer cannot mutate, agent cannot read UI APIs).

## Questions to consider asking me (in Polish)
- Session length for the non-remembered session and the remember duration (default 12 h / 90 days).
- Whether the viewer password should be changeable only via env or also from the UI by the editor.

## Acceptance criteria
- Logging in with `lk` gives read-only access. Logging in with the editor password gives editing controls.
- Role switching works both ways. The remember checkbox survives a browser restart. An unchecked login does not survive it.
- A forged or expired cookie → 401. Too many wrong passwords → 429.
```
