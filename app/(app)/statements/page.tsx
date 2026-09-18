import { StatementsView } from '../../../components/documents/statements-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('document.manage');

  return <StatementsView />;
}
