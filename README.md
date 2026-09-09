# Ruzivo

School finance management — payments, expenses, owing balances, and PDF reporting. One Next.js codebase, shipped two ways: as a web app, and as a Windows desktop app (Electron) with its own managed PostgreSQL.

## Web development

```bash
cp .env.example .env.local   # fill in PG* to point at a local Postgres
npm install
npm run migrate              # applies migrations/*.sql
npm run dev
```

Open http://localhost:3000.

Other scripts: `npm run build` / `npm run start` (production web server), `npm run lint`, `npm run typecheck`, `npm test`.

## Desktop development

The Electron shell spawns the same Next.js app as a child process and points a `BrowserWindow` at it — no separate frontend. Two ways to run it locally:

```bash
# Thin viewer over `next dev` (fastest inner loop, HMR works as normal)
npm run dev              # in one terminal
npm run electron:dev     # in another

# Exercise the real production startup path (Postgres setup screen,
# migrations, spawned standalone server) without a full installer build
RUZIVO_FORCE_PRODUCTION=1 npm run electron:dev
```

To build and run the actual packaged app:

```bash
npm run electron:build:prod
npx electron-builder --dir --win   # release/win-unpacked/Ruzivo.exe
```

See [docs/bulk-operations.md](docs/bulk-operations.md) for bulk creates and PDF export, [docs/desktop.md](docs/desktop.md) for the desktop architecture (process model, platform abstraction, PostgreSQL provisioning), [docs/migrations.md](docs/migrations.md) for schema changes, [docs/releasing.md](docs/releasing.md) for cutting a release, and [docs/troubleshooting.md](docs/troubleshooting.md) for known packaging gotchas.

## Project structure

- `app/` — Next.js App Router routes and layouts (thin Server Components rendering `components/*` client views)
- `components/` — feature UI (`payments/`, `expenses/`, `learners/`, `reports/`, `school/`, `reference-data/`, `layout/`)
- `services/` — client-side fetch layer
- `repositories/` — one raw-SQL function per file, grouped by entity and CRUD verb
- `lib/` — `db.ts` (pool/query/transaction), `platform/` (web/desktop abstraction), `pdf/`, `currency.ts`
- `migrations/` — versioned `node-pg-migrate` SQL migrations (source of truth for the schema)
- `electron/` — the desktop shell: main process, preload, Postgres provisioning, updater
- `.github/workflows/` — CI (`test.yml`, `build.yml`) and release (`release.yml`)
