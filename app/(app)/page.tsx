import { OverviewView } from '../../components/overview/overview-view';
import { requirePageAccess } from '../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('overview.view');

  return <OverviewView />;
}
