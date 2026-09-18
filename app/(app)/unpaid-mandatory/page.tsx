import { UnpaidMandatoryView } from '../../../components/owing/unpaid-mandatory-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('obligation.read');

  return <UnpaidMandatoryView />;
}
