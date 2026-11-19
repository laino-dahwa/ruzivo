import { ExpectedFeesView } from '../../../components/expected-fees/expected-fees-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('obligation.read');

  return <ExpectedFeesView />;
}
