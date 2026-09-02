import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Desktop-only DB config: non-secret fields live in a plain JSON file in the
// app's userData directory; the password is encrypted at rest via Electron's
// safeStorage (OS keychain-backed) and never written in plaintext.

export interface DesktopDbConfig {
  host: string;
  port: number;
  user: string;
  database: string;
}

/**
 * 'existing' — connects to a PostgreSQL server the user already had running;
 * Ruzivo never starts/stops it.
 * 'embedded' — Ruzivo provisioned its own PostgreSQL cluster in this app's
 * userData directory and owns its lifecycle (must start it on every launch,
 * stop it on quit).
 */
export type ProvisioningMode = 'existing' | 'embedded';

interface StoredConfig {
  db?: DesktopDbConfig;
  encryptedPassword?: string;
  provisioning?: ProvisioningMode;
}

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function readStored(): StoredConfig {
  const file = configPath();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeStored(config: StoredConfig) {
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
}

export function getDbConfig(): (DesktopDbConfig & { password: string }) | null {
  const stored = readStored();
  if (!stored.db || !stored.encryptedPassword) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  const password = safeStorage.decryptString(Buffer.from(stored.encryptedPassword, 'base64'));
  return { ...stored.db, password };
}

export function getProvisioningMode(): ProvisioningMode | null {
  return readStored().provisioning ?? null;
}

export function saveDbConfig(config: DesktopDbConfig & { password: string }, provisioning: ProvisioningMode) {
  const { password, ...db } = config;
  const encryptedPassword = safeStorage.encryptString(password).toString('base64');
  writeStored({ db, encryptedPassword, provisioning });
}
