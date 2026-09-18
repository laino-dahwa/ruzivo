import { SchoolSetupView } from '../../../components/school/school-setup-view';
import { requirePageAccess } from '../../../lib/auth/page-guard';

export default async function Page() {
  await requirePageAccess('school.manage');

  return <SchoolSetupView />;
}
