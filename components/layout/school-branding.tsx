'use client';

import { useEffect } from 'react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { useSchoolLogo } from '../../lib/client/use-school-logo';
import { DEFAULT_APP_NAME, useSchoolName } from '../../lib/client/use-school-name';
import { schoolLogoUrl } from '../../services/logo';

/**
 * Puts the active school's identity on the document itself: the tab's title and
 * its icon.
 *
 * The icon has to be set from the client rather than through the route's
 * metadata: which school is active lives in localStorage, so the server has no
 * idea whose logo to advertise when the document is rendered.
 *
 * In the desktop build this also drives the taskbar icon — Windows shows the
 * window's icon there — via the preload bridge.
 */
export function SchoolBranding() {
  const { schoolId } = useCurrentSchoolId();
  const { hasLogo, stamp } = useSchoolLogo(schoolId);
  const { name } = useSchoolName();

  // The tab is named for the school, falling back to the app's own name when
  // none is chosen — the same rule the sidebar and the reports follow.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.title;
    document.title = name || DEFAULT_APP_NAME;
    return () => { document.title = previous; };
  }, [name]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? createIconLink();
    const previous = link.getAttribute('href');

    if (!schoolId || !hasLogo) {
      // Back to whatever the app shipped with, so removing a logo does not
      // leave the previous school's mark in the tab.
      link.setAttribute('href', '/favicon.ico');
      link.setAttribute('type', 'image/x-icon');
      return;
    }

    link.setAttribute('href', schoolLogoUrl(schoolId, { size: 64, stamp }));
    link.setAttribute('type', 'image/png');

    return () => {
      if (previous) link.setAttribute('href', previous);
    };
  }, [schoolId, hasLogo, stamp]);

  // The desktop window icon is a separate concern from the tab: it wants the
  // .ico, and it is set through the main process.
  useEffect(() => {
    const bridge = typeof window !== 'undefined'
      ? (window as { ruzivoDesktop?: { setWindowIcon?: (url: string) => void } }).ruzivoDesktop
      : undefined;
    if (!bridge?.setWindowIcon || !schoolId || !hasLogo) return;
    bridge.setWindowIcon(schoolLogoUrl(schoolId, { ico: true, stamp }));
  }, [schoolId, hasLogo, stamp]);

  return null;
}

function createIconLink(): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'icon';
  document.head.appendChild(link);
  return link;
}
