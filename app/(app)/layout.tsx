import type { ReactNode } from 'react';
import { AppShell } from '../../components/layout/app-shell';
import { requireSignedIn } from '../../lib/auth/page-guard';

/**
 * Applies to every page in the group: all of them resolve the signed-in user
 * and read the database, neither of which means anything at build time.
 * Declared here rather than repeated on eight pages, and so a new page added
 * to the group inherits it instead of breaking the build.
 */
export const dynamic = 'force-dynamic';

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Redirects to /setup, /login or /change-password as appropriate. Every
  // page in this group also checks its own capability; this only establishes
  // that somebody is signed in and hands the shell who they are.
  const actor = await requireSignedIn();

  return (
    <AppShell
      actor={{
        first_name: actor.first_name,
        last_name: actor.last_name,
        email: actor.email,
        access_level: actor.access_level,
        active_school_id: actor.active_school_id,
      }}
    >
      {children}
    </AppShell>
  );
}
