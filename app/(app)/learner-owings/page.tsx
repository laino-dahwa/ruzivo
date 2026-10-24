import { LearnerOwingsView } from '../../../components/owing/learner-owings-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('obligation.read');

  return <LearnerOwingsView />;
}
