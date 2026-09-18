import { LearnersView } from '../../../components/learners/learners-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('learner.read');

  return <LearnersView />;
}
