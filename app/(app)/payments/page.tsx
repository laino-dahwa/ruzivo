import { PaymentsView } from '../../../components/payments/payments-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('payment.read');

  return <PaymentsView />;
}
