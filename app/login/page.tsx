import { redirect } from 'next/navigation';
import { LoginView } from '../../components/auth/login-view';
import { getPageActor } from '../../lib/auth/page-guard';
import { hasAdministrator } from '../../repositories/auth/bootstrap';
import { LANDING_ROUTE } from '../../lib/auth/permissions';

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
