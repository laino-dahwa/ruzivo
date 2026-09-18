import { redirect } from 'next/navigation';
import { ChangePasswordView } from '../../components/auth/change-password-view';
import { getPageActor } from '../../lib/auth/page-guard';

/** Depends entirely on who is signed in, so there is nothing to prerender. */
export const dynamic = 'force-dynamic';

export default async function Page() {
  const actor = await getPageActor();

  if (!actor) {
    redirect('/login');
  }

  return <ChangePasswordView forced={actor.must_change_password} />;
}
