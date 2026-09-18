import { SetupView } from '../../components/auth/setup-view';

// The view asks the API whether setup is still available and says so plainly
// if it is not — the endpoint refuses either way, so there is nothing to
// protect here beyond not being confusing.
export default function Page() {
  return <SetupView />;
}
