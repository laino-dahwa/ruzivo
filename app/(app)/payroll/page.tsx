import { PayrollView } from '../../../components/payroll/payroll-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('payroll.manage');

  return <PayrollView />;
}
