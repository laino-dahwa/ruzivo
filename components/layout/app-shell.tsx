'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { useSchoolLogo } from '../../lib/client/use-school-logo';
import { useSchoolName } from '../../lib/client/use-school-name';
import { schoolLogoUrl } from '../../services/logo';
import { can, type AccessLevel } from '../../lib/auth/permissions';
import { GROUPING_THRESHOLD, NAV_GROUP_LABELS, NAV_GROUP_ORDER, nav, type NavItem } from './nav-config';
import { UpdateNotice } from './update-notice';
import { SchoolBranding } from './school-branding';
import { UserMenu } from './user-menu';

export type ShellActor = {
  first_name: string;
  last_name: string;
  email: string;
  access_level: AccessLevel;
  active_school_id: string;
};


/**
 * Steps the brand type down as the name gets longer, so a long school name
 * fits the sidebar on a reasonable number of lines without ever being cut
 * short. Chosen over truncation because the name is the school's identity —
 * seeing all of it matters more than keeping it to one line.
 */
function brandNameSize(name: string): string {
  if (name.length <= 16) return 'text-[15px]';
  if (name.length <= 28) return 'text-[13px]';
  if (name.length <= 44) return 'text-[12px]';
  return 'text-[11px]';
}

export function AppShell({ children, actor }: { children: ReactNode; actor: ShellActor }) {
  const pathname = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  const { schoolId } = useCurrentSchoolId();
  const { hasLogo, stamp } = useSchoolLogo(schoolId);
  const { name: schoolName } = useSchoolName();

  const visibleNav = nav.filter((item) => can(actor.access_level, item.capability));
  // A short list reads fine as one run; headings only start earning their
  // space once there is enough to sort through.
  const grouped = visibleNav.length >= GROUPING_THRESHOLD;
  const ungrouped = visibleNav.filter((item) => !item.group);

  // The breadcrumb used to read "Live data from your API", which told nobody
  // anything. The longest matching href wins so /unpaid-mandatory is not
  // claimed by /, which every path starts with.
  const currentPage =
    [...nav]
      .filter((item) => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)))
      .sort((a, b) => b.href.length - a.href.length)[0]?.label ?? '';

  const renderLink = ({ href, label, icon: Icon }: NavItem) => (
    <Link
      key={href}
      href={href}
      onClick={() => setMobileNav(false)}
      data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
      className={`nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium ${
        pathname === href || (href !== '/' && pathname.startsWith(href))
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'
      }`}
    >
      <Icon size={17} strokeWidth={1.8} />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className="grain min-h-[100dvh] bg-background md:flex">
      <UpdateNotice />
      <SchoolBranding />
      {/* sidebar-scroll keeps the scrollbar out of sight until the sidebar is
          hovered. Scrolling itself stays enabled on purpose: on a short screen
          the last link must still be reachable, and clipping it would be a
          worse problem than a scrollbar. */}
      <aside className={`sidebar-scroll fixed inset-y-0 left-0 z-40 w-[254px] overflow-y-auto bg-sidebar px-5 py-5 text-sidebar-foreground transition-transform duration-300 md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          {/* The close button is positioned rather than laid out beside the
              brand, so the brand can be a centred stack across the full width. */}
          <div className="relative px-2">
            <Link href="/" data-testid="link-brand" className="flex flex-col items-center gap-2.5 text-center text-sidebar-foreground">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground">
                {schoolId && hasLogo
                  // eslint-disable-next-line @next/next/no-img-element -- served from an API route, not a static asset
                  ? <img src={schoolLogoUrl(schoolId, { size: 128, stamp })} alt="" className="h-full w-full object-contain" />
                  // eslint-disable-next-line @next/next/no-img-element -- kept a plain img, consistent with the school logo above
                  : <img src="/branding/logo/logo.png" alt="" className="h-full w-full object-contain" />}
              </span>
              <span className="w-full">
                {/* No truncation: the whole name is shown however long it is.
                    It wraps, and the type steps down as it gets longer so a
                    long name stays on a sensible number of lines. Long
                    unbroken words break mid-word rather than overflow. */}
                <span
                  className={`block font-semibold leading-tight [overflow-wrap:anywhere] ${brandNameSize(schoolName)}`}
                  data-testid="text-brand-name"
                >
                  {schoolName}
                </span>
                <span className="mt-1 block text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/55">Finance office</span>
              </span>
            </Link>
            <button type="button" onClick={() => setMobileNav(false)} className="absolute right-0 top-0 text-sidebar-foreground/60 md:hidden" aria-label="Close navigation" data-testid="button-close-navigation"><X size={19} /></button>
          </div>
          <nav className="mt-7 space-y-1" aria-label="Primary navigation">
            {ungrouped.map(renderLink)}

            {grouped
              ? NAV_GROUP_ORDER.map((group) => {
                  const items = visibleNav.filter((item) => item.group === group);
                  if (items.length === 0) {
                    return null;
                  }
                  return (
                    <div key={group} className="pt-4 first:pt-2">
                      <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-sidebar-foreground/40">
                        {NAV_GROUP_LABELS[group]}
                      </div>
                      <div className="space-y-1">{items.map(renderLink)}</div>
                    </div>
                  );
                })
              : visibleNav.filter((item) => item.group).map(renderLink)}
          </nav>
        </div>
      </aside>
      {mobileNav && <button type="button" aria-label="Close menu overlay" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" data-testid="button-menu-overlay" />}
      <main className="min-w-0 flex-1 md:ml-[254px]">
        <header className="flex h-[76px] items-center justify-between border-b border-border/70 px-5 md:px-10">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-muted-foreground md:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span data-testid="text-breadcrumb-name">{schoolName}</span>
              <span className="text-border">/</span>
              <span className="text-foreground" data-testid="text-breadcrumb-page">{currentPage}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <UserMenu actor={actor} />
          </div>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
