import { app, ipcMain, type BrowserWindow } from 'electron';
import { Pool } from 'pg';
import { createAppAccess } from '../app-access';
import type { DesktopDbConfig } from '../config-store';
import { discardOutbox, getState, requestFullSync, runSync, SyncError, type SyncRunResult } from './engine';
import { createLink, getLink, getLinkInfo, removeLink } from './link';

type DbConfig = DesktopDbConfig & { password: string };

export type SyncIpcDeps = {
  getMainWindow(): BrowserWindow | null;
  getAppOrigin(): string | null;
  getDbConfig(): DbConfig | null;
  /** True while a backup, restore or migration is running: syncing waits. */
  isBusy(): boolean;
};

/** How often changes are sent while the app is open. */
const INTERVAL_MS = 5 * 60 * 1000;
/** First run shortly after startup, once the app has settled. */
const FIRST_RUN_DELAY_MS = 30 * 1000;

export type SyncController = {
  /** Runs a sync soon (after a backup or restore). */
  requestRun(reason: string): void;
  stop(): void;
};

async function withPool<T>(config: DbConfig, work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ ...config, max: 2 });
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

/** sync_outbox exists only once migration 014 has run. */
async function hasSyncTables(pool: Pool): Promise<boolean> {
  const result = await pool.query("SELECT to_regclass('public.sync_outbox') IS NOT NULL AS ok");
  return result.rows[0]?.ok === true;
}

export function registerSyncIpc(deps: SyncIpcDeps): SyncController {
  const { fromAppWindow, authorise } = createAppAccess(deps);
  let running: Promise<SyncRunResult | null> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let soon: NodeJS.Timeout | null = null;

  /** One run at a time; a second caller shares the run already going. */
  function run(): Promise<SyncRunResult | null> {
    if (running) return running;
    running = (async () => {
      const config = deps.getDbConfig();
      if (!config || deps.isBusy()) return null;
      return withPool(config, async (pool) => {
        if (!(await hasSyncTables(pool))) return null;
        const link = getLink();
        if (!link) {
          await discardOutbox(pool);
          return null;
        }
        return runSync(pool, link, app.getVersion());
      });
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function tick() {
    run().catch((error) => {
      // Being offline is normal for a school computer; it just retries later.
      if (!(error instanceof SyncError && error.code === 'offline')) console.warn('[sync]', error);
    });
  }

  timer = setInterval(tick, INTERVAL_MS);
  soon = setTimeout(tick, FIRST_RUN_DELAY_MS);

  async function status() {
    const config = deps.getDbConfig();
    if (!config) return { ok: false as const, error: 'No database is configured.' };
    return withPool(config, async (pool) => {
      const ready = await hasSyncTables(pool);
      const state = ready ? await getState(pool) : {};
      const pending = ready ? (await pool.query('SELECT count(*)::int AS n FROM sync_outbox')).rows[0].n : 0;
      const link = getLinkInfo();
      return {
        ok: true as const,
        linked: link,
        running: running !== null,
        pending: link ? pending : 0,
        needsFullSync: state.needs_full_sync === 'true',
        lastSuccessAt: state.last_success_at ?? null,
        lastFullSyncAt: state.last_full_sync_at ?? null,
        lastError: state.last_error ?? null,
        lastErrorAt: state.last_error_at ?? null,
      };
    });
  }

  function failure(error: unknown) {
    if (!(error instanceof SyncError)) console.error('[sync]', error);
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }

  ipcMain.handle('sync:status', async (event) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      const auth = await authorise('backup');
      if (!auth.ok) return auth;
      return await status();
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('sync:now', async (event) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      const auth = await authorise('backup');
      if (!auth.ok) return auth;
      if (!getLink()) return { ok: false, error: 'This computer is not linked to a website yet.' };
      if (deps.isBusy()) return { ok: false, error: 'A backup or restore is running. Try again when it has finished.' };
      const result = await run();
      return { ok: true, result };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('sync:link', async (event, input: unknown) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    const { workerUrl, linkCode, password } = (input ?? {}) as { workerUrl?: string; linkCode?: string; password?: string };
    try {
      const auth = await authorise('sync-link', typeof password === 'string' ? password : '');
      if (!auth.ok) return auth;
      if (typeof workerUrl !== 'string' || typeof linkCode !== 'string' || !linkCode.trim()) {
        return { ok: false, error: 'Enter the website address and the link code.' };
      }
      const config = deps.getDbConfig();
      if (!config) return { ok: false, error: 'No database is configured.' };

      const label = `${auth.actor.label} on ${process.env.COMPUTERNAME ?? 'this computer'}`;
      const link = await createLink({ workerUrl, linkCode, label, linkedBy: auth.actor.label });
      await withPool(config, async (pool) => {
        if (await hasSyncTables(pool)) await requestFullSync(pool);
        await pool
          .query(
            `INSERT INTO audit_log (employee_id, actor_label, school_id, action, entity_type, entity_id, summary, detail)
             VALUES ($1, $2, $3, 'system.sync_link', 'system', NULL, $4, $5::jsonb)`,
            [auth.actor.employee_id, auth.actor.label, auth.actor.school_id, `Linked this computer to the website ${link.workerUrl}`, JSON.stringify({ workerUrl: link.workerUrl, installId: link.installId })]
          )
          .catch((error) => console.warn('[sync] could not write audit entry:', error));
      });
      tick(); // the first full sync starts straight away
      return { ok: true, linked: link };
    } catch (error) {
      return failure(error);
    }
  });

  ipcMain.handle('sync:unlink', async (event) => {
    if (!fromAppWindow(event)) return { ok: false, error: 'Not allowed.' };
    try {
      const auth = await authorise('backup');
      if (!auth.ok) return auth;
      const link = getLinkInfo();
      removeLink();
      const config = deps.getDbConfig();
      if (config && link) {
        await withPool(config, (pool) =>
          pool.query(
            `INSERT INTO audit_log (employee_id, actor_label, school_id, action, entity_type, entity_id, summary, detail)
             VALUES ($1, $2, $3, 'system.sync_unlink', 'system', NULL, $4, $5::jsonb)`,
            [auth.actor.employee_id, auth.actor.label, auth.actor.school_id, `Stopped sending data to the website ${link.workerUrl}`, JSON.stringify({ workerUrl: link.workerUrl })]
          )
        ).catch((error) => console.warn('[sync] could not write audit entry:', error));
      }
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  });

  return {
    requestRun(reason) {
      console.log(`[sync] run requested (${reason})`);
      setTimeout(tick, 2000);
    },
    stop() {
      if (timer) clearInterval(timer);
      if (soon) clearTimeout(soon);
      timer = soon = null;
    },
  };
}
