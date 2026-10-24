import type { DesktopDbConfig } from './config-store';

function toRunnerConfig(config: DesktopDbConfig & { password: string }, migrationsDir: string) {
  return {
    databaseUrl: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    },
    dir: migrationsDir,
    direction: 'up' as const,
    migrationsTable: 'pgmigrations',
  };
}

/**
 * node-pg-migrate is pure ESM and this file compiles to CommonJS (Electron's
 * main process), so it can only be loaded through a dynamic import. The
 * promise is kept rather than the module, so two callers racing each other
 * still only pay for one import — it used to be re-imported on every call,
 * which meant loading the whole migration library twice on every launch.
 */
// The type is inferred from the import expression rather than written out:
// naming it would be a *type* import of an ESM module from CommonJS, which
// TypeScript rejects without a resolution-mode attribute.
function importRunner() {
  return import('node-pg-migrate').then((module) => module.runner);
}

let runnerPromise: ReturnType<typeof importRunner> | null = null;

function loadRunner() {
  if (!runnerPromise) {
    runnerPromise = importRunner();
  }
  return runnerPromise;
}

/**
 * Reports which migrations would run, without applying them (node-pg-migrate's
 * dryRun option — verified separately to neither run migration SQL nor
 * affect application tables, though it does create the empty pgmigrations
 * tracking table as a harmless side effect). Used to decide whether a
 * pre-migration backup is worth taking at all — most launches have nothing
 * pending, and skipping the backup then avoids unnecessary startup latency.
 */
export async function getPendingMigrations(config: DesktopDbConfig & { password: string }, migrationsDir: string): Promise<string[]> {
  const runner = await loadRunner();
  const pending = await runner({
    ...toRunnerConfig(config, migrationsDir),
    dryRun: true,
    log: () => {}, // silent — the real run logs; a dry run is just a check
  });
  return pending.map((m) => m.name);
}

/** Applies any pending migrations from migrations/. Shares the exact same migration files as the web deploy path (scripts/migrate.mjs) and the app's tests — never a separate schema definition. */
export async function applyMigrations(config: DesktopDbConfig & { password: string }, migrationsDir: string): Promise<string[]> {
  const runner = await loadRunner();
  const applied = await runner({
    ...toRunnerConfig(config, migrationsDir),
    log: (msg) => console.log('[migrate]', msg),
  });
  return applied.map((m) => m.name);
}

/**
 * Runs the same migrations into another schema of the same database - all of
 * them, or only the first `count`. A restore uses this to rebuild a backup at
 * its own schema version before bringing it up to date (backup/restore-backup.ts).
 */
export async function migrateSchema(
  config: DesktopDbConfig & { password: string },
  migrationsDir: string,
  options: { schema: string; count?: number }
): Promise<void> {
  const runner = await loadRunner();
  await runner({
    ...toRunnerConfig(config, migrationsDir),
    schema: options.schema,
    migrationsSchema: options.schema,
    createSchema: true,
    createMigrationsSchema: true,
    ...(options.count !== undefined ? { count: options.count } : {}),
    log: () => {},
  });
}
