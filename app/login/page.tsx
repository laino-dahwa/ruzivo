import { redirect } from 'next/navigation';
import { LoginView } from '../../components/auth/login-view';
import { getPageActor } from '../../lib/auth/page-guard';
import { hasAdministrator } from '../../repositories/auth/bootstrap';
import { LANDING_ROUTE } from '../../lib/auth/permissions';

/**
 * Never prerendered.
 *
 * This page asks the database whether an administrator exists before it ever
 * touches cookies, so without this the production build tries to render it at
 * build time and dies on the first query — there is no database during a
 * build. It broke CI exactly once; the answer to "who is signed in" is
 * per-request by definition, so there was never anything to prerender.
 */
export const dynamic = 'force-dynamic';

export default async function Page() {
  // Nothing to sign in to yet.
  if (!(await hasAdministrator())) {
    redirect('/setup');
  }

  const actor = await getPageActor();
  if (actor) {
    redirect(actor.must_change_password ? '/change-password' : LANDING_ROUTE[actor.access_level]);
  }

  return <LoginView />;
}
