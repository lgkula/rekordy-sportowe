# Rekordy sportowe

A personal web app that presents sports records (running, trail running): personal records, races and activities, with imports from FIT files and Strava / Garmin Connect exports.

- Plan and decisions: [docs/PLAN.md](docs/PLAN.md)
- Implementation prompts: [docs/prompts/](docs/prompts/README.md)
- Deployment: [docs/WDROZENIE.md](docs/WDROZENIE.md) (PL), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (EN)
- Working rules for Claude Code: [CLAUDE.md](CLAUDE.md)

## Quick start (local)

Requirements: Node.js 22 (`.nvmrc`), MariaDB/MySQL (XAMPP).

```bash
npm install
cp apps/server/.env.example apps/server/.env   # adjust DB settings
npm run db:migrate
npm run dev                                     # http://localhost:5173
```
