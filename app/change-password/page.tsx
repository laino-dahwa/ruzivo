import { redirect } from 'next/navigation';
import { ChangePasswordView } from '../../components/auth/change-password-view';
import { getPageActor } from '../../lib/auth/page-guard';

export default async function Page() {
  const actor = await getPageActor();

  if (!actor) {
    redirect('/login');
  }

  return <ChangePasswordView forced={actor.must_change_password} />;
}
