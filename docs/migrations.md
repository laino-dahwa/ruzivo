# Database migrations

Schema changes go through [`node-pg-migrate`](https://github.com/salsita/node-pg-migrate) — versioned, numbered `.sql` files in `migrations/`, tracked in a `pgmigrations` table. This is the single source of truth for the schema on both web and desktop; nothing bootstraps or infers the schema any other way.

## Writing a new migration

Add a new numbered file, e.g. `migrations/002_add_something.sql`, using the `-- Up Migration` / `-- Down Migration` comment markers:

```sql
-- Up Migration
ALTER TABLE payments ADD COLUMN notes TEXT;

-- Down Migration
ALTER TABLE payments DROP COLUMN notes;
```

**Never edit `001_initial_schema.sql` (or any already-released migration) after it has shipped.** Anyone who has already run it has that exact schema recorded in `pgmigrations` — editing it retroactively only affects fresh installs and creates drift between machines. Add a new numbered file instead, even for a one-line fix.

Foreign keys to `schools` generally need `ON DELETE CASCADE` — `repositories/school/delete/deteleSchool.ts` does a bare `DELETE FROM schools WHERE school_id = $1` with no manual child cleanup, so a school with un-cascaded reference data (genders, payment methods, categories, etc.) would fail to delete with an FK violation. `learners`' FKs to `schools`/`genders` deliberately do **not** cascade, since learner deletion is a soft delete (`deleted_at`), not a hard one.

## Running migrations

```bash
npm run migrate
```

`scripts/migrate.mjs` reads `.env.local` (or the real environment in CI/production), creates the target database if it doesn't exist yet, and applies every pending migration in order.

- **Web**: run this as a deploy-time step before `next start` picks up a new release.
- **Desktop**: happens automatically on every launch, before the Next.js server starts — see [docs/desktop.md](desktop.md#startup-sequence-production).

## Backups

Migrations never run against unbacked-up data on desktop. `electron/main.ts`'s startup sequence calls `getPendingMigrations()` (a `node-pg-migrate` dry run) first; if anything is pending, it backs up before calling `applyMigrations()`:

- **Embedded Postgres**: a cold file-copy of the whole data directory (`electron/backup-manager.ts#backupEmbeddedDataDir`) — Postgres is stopped first, since copying a live data directory isn't safe. Verified by checking `PG_VERSION` exists in the copy. Kept in `userData/backups/`, rotated to the last 10.
- **Existing Postgres**: best-effort `pg_dump` (`backupExistingViaPgDump`) if `pg_dump.exe` can be found under the standard `C:\Program Files\PostgreSQL\<version>\bin\` install location. Ruzivo doesn't own this server, so if `pg_dump` isn't found, it logs a warning and proceeds with the migration anyway rather than blocking startup.

## Testing

`__tests__/migrations.test.ts` applies the real migration files against a throwaway database and asserts: they apply cleanly, produce the expected tables/columns, cascade deletes correctly, and that re-running migrations is a no-op. Run it with the rest of the suite: `npm test`. Add coverage here for any migration that changes cascade behavior or column shape — this is the test that would have caught the schema drift issues found while building this pipeline (see [docs/troubleshooting.md](troubleshooting.md)).
