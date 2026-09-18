import { ExpensesView } from '../../../components/expenses/expenses-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('expense.read');

  return <ExpensesView />;
}
