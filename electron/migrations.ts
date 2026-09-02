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
 * Reports which migrations would run, without applying them (node-pg-migrate's
 * dryRun option — verified separately to neither run migration SQL nor
 * affect application tables, though it does create the empty pgmigrations
 * tracking table as a harmless side effect). Used to decide whether a
 * pre-migration backup is worth taking at all — most launches have nothing
 * pending, and skipping the backup then avoids unnecessary startup latency.
 */
export async function getPendingMigrations(config: DesktopDbConfig & { password: string }, migrationsDir: string): Promise<string[]> {
  const { runner } = await import('node-pg-migrate');
  const pending = await runner({
    ...toRunnerConfig(config, migrationsDir),
    dryRun: true,
    log: () => {}, // silent — the real run logs; a dry run is just a check
  });
  return pending.map((m) => m.name);
}

/** Applies any pending migrations from migrations/. Shares the exact same migration files as the web deploy path (scripts/migrate.mjs) and the app's tests — never a separate schema definition. */
export async function applyMigrations(config: DesktopDbConfig & { password: string }, migrationsDir: string): Promise<string[]> {
  // node-pg-migrate is a pure-ESM package; this file compiles to CommonJS
  // (Electron's main process), so it must be loaded via a dynamic import
  // rather than a static one.
  const { runner } = await import('node-pg-migrate');
  const applied = await runner({
    ...toRunnerConfig(config, migrationsDir),
    log: (msg) => console.log('[migrate]', msg),
  });
  return applied.map((m) => m.name);
}
