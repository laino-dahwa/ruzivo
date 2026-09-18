import { OwingView } from '../../../components/owing/owing-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('balance.read');

  return <OwingView />;
}
