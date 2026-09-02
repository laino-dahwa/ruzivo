import { Client, Pool } from 'pg';
import type { DesktopDbConfig } from './config-store';

type FullConfig = DesktopDbConfig & { password: string };

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Connects to the server's maintenance DB to verify the credentials/host reach a real Postgres instance. */
export async function testConnection(config: FullConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = new Client({ host: config.host, port: config.port, user: config.user, password: config.password, database: 'postgres' });
  try {
    await client.connect();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Creates the application database if it doesn't already exist. Never touches an existing database's contents. */
export async function ensureDatabaseExists(config: FullConfig): Promise<void> {
  const adminPool = new Pool({ host: config.host, port: config.port, user: config.user, password: config.password, database: 'postgres' });
  try {
    const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
    if (result.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
    }
  } finally {
    await adminPool.end();
  }
}
