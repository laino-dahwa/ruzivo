import { redirect } from 'next/navigation';
import { SecurityKeyView } from '../../components/auth/security-key-view';
import { getPageActor } from '../../lib/auth/page-guard';

/** Depends entirely on who is signed in, so there is nothing to prerender. */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await getPageActor();

  if (!actor) {
    redirect('/login');
  }
  // A temporary password has to be replaced before anything else.
  if (actor.must_change_password) {
    redirect('/change-password');
  }

  return <SecurityKeyView />;
}
