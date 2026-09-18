import { ReportsView } from '../../../components/reports/reports-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('report.read');

  return <ReportsView />;
}
