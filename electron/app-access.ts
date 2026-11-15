import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

export type Actor = { employee_id: number | null; label: string; school_id: string | null };
export type Failure = { ok: false; error: string };

/**
 * What the app's own server says about a privileged desktop action. Purposes
 * are checked by app/api/system/backup-access/route.ts; 'restore' and
 * 'sync-link' also re-ask for the person's password.
 */
export type AccessPurpose = 'backup' | 'restore' | 'sync-link';

export type AppAccessDeps = {
  getMainWindow(): BrowserWindow | null;
  /** The origin the main window's app is served from, e.g. http://127.0.0.1:3100. */
  getAppOrigin(): string | null;
};

export function createAppAccess(deps: AppAccessDeps) {
  /** Only the app's own main window, showing the app's own pages, may ask. */
  function fromAppWindow(event: IpcMainInvokeEvent): boolean {
    const window = deps.getMainWindow();
    const origin = deps.getAppOrigin();
    if (!window || !origin || event.sender !== window.webContents) return false;
    try {
      return new URL(event.senderFrame?.url ?? '').origin === origin;
    } catch {
      return false;
    }
  }

  /**
   * Asks the app's own server whether the person signed in to the window may
   * do this, by forwarding the window's session cookie - the same check, and
   * the same audit identity, as every other admin action.
   */
  async function authorise(purpose: AccessPurpose, password?: string): Promise<{ ok: true; actor: Actor } | Failure> {
    const window = deps.getMainWindow();
    const origin = deps.getAppOrigin();
    if (!window || !origin) return { ok: false, error: 'The app is not ready yet.' };

    const cookies = await window.webContents.session.cookies.get({ url: origin });
    const response = await fetch(`${origin}/api/system/backup-access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
      body: JSON.stringify({ purpose, password }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; actor?: Actor };
    if (!response.ok) {
      return { ok: false, error: body?.error ?? (response.status === 403 ? 'Only an administrator can do this.' : 'Please sign in again.') };
    }
    return { ok: true, actor: body.actor as Actor };
  }

  return { fromAppWindow, authorise };
}
