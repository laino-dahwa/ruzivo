'use client';

import { useSyncExternalStore } from 'react';
import { getDesktopBridge, type BackupBridge, type SyncBridge } from '../../lib/platform';

const noSubscription = () => () => {};

/**
 * The desktop app's backup bridge, or null on the web (and during the server
 * render, where there is no window). The bridge never changes once the page
 * has loaded, so there is nothing to subscribe to.
 */
export function useBackupBridge(): BackupBridge | null {
  return useSyncExternalStore(noSubscription, () => getDesktopBridge()?.backup ?? null, () => null);
}

/** The desktop app's cloud-website sync bridge, or null on the web and in older desktop builds. */
export function useSyncBridge(): SyncBridge | null {
  return useSyncExternalStore(noSubscription, () => getDesktopBridge()?.sync ?? null, () => null);
}

/** A full page load, not a client-side route change: after a restore every cached screen is stale. */
export function reloadToSignIn(): void {
  window.location.assign(new URL('/login', window.location.href).toString());
}
