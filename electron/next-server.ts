import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import type { DesktopDbConfig } from './config-store';

let child: ChildProcess | null = null;

/**
 * Spawns the pre-built Next.js `output: 'standalone'` server as a child
 * process with the desktop's Postgres config injected via env vars, and
 * resolves once it reports readiness on stdout. This is the exact same
 * compiled Next.js app the web deployment runs — Electron never re-hosts
 * any app code itself.
 */
export async function startNextServer(options: {
  appRoot: string;
  port: number;
  dbConfig: DesktopDbConfig & { password: string };
}): Promise<void> {
  const serverPath = path.join(options.appRoot, '.next', 'standalone', 'server.js');

  child = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      // process.execPath is the Electron binary itself when spawned from
      // Electron's main process — without this, it launches a second full
      // Electron app instance (using server.js as an unrecognized extra
      // argument) instead of running it as a plain Node script. This is
      // Electron's own documented technique for spawning a real Node
      // child process via process.execPath.
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(options.port),
      HOSTNAME: '127.0.0.1',
      PGHOST: options.dbConfig.host,
      PGPORT: String(options.dbConfig.port),
      PGUSER: options.dbConfig.user,
      PGPASSWORD: options.dbConfig.password,
      PGDATABASE: options.dbConfig.database,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next.js server did not become ready within 30s')), 30000);

    child?.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      console.log('[next]', text.trim());
      if (/ready/i.test(text)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child?.stderr?.on('data', (chunk: Buffer) => console.error('[next]', chunk.toString().trim()));
    child?.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child?.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Next.js server exited early (code ${code})`));
    });
  });
}

export function stopNextServer(): void {
  child?.kill();
  child = null;
}
