import { permanentRedirect } from 'next/navigation';

// Learner owings and the old Expected fees table were combined into one page.
// Kept so bookmarks and old links still land somewhere useful.
export default function Page() {
  permanentRedirect('/expected-fees');
}
