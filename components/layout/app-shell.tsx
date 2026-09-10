'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { CalendarDays, Menu, WalletCards, X } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { useSchoolLogo } from '../../lib/client/use-school-logo';
import { useSchoolName } from '../../lib/client/use-school-name';
import { schoolLogoUrl } from '../../services/logo';
import { nav } from './nav-config';
import { UpdateNotice } from './update-notice';
import { SchoolBranding } from './school-branding';


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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNav, setMobileNav] = useState(false);
  const { schoolId } = useCurrentSchoolId();
  const { hasLogo, stamp } = useSchoolLogo(schoolId);
  const { name: schoolName } = useSchoolName();

  return (
    <div className="grain min-h-[100dvh] bg-background md:flex">
      <UpdateNotice />
      <SchoolBranding />
      <aside className={`fixed inset-y-0 left-0 z-40 w-[254px] bg-sidebar px-5 py-6 text-sidebar-foreground transition-transform duration-300 md:relative md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          {/* The close button is positioned rather than laid out beside the
              brand, so the brand can be a centred stack across the full width. */}
          <div className="relative px-2">
            <Link href="/" data-testid="link-brand" className="flex flex-col items-center gap-2.5 text-center text-sidebar-foreground">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground">
                {schoolId && hasLogo
                  // eslint-disable-next-line @next/next/no-img-element -- served from an API route, not a static asset
                  ? <img src={schoolLogoUrl(schoolId, { size: 128, stamp })} alt="" className="h-full w-full object-contain" />
                  : <WalletCards size={30} strokeWidth={2.1} />}
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
          <div className="mt-12 px-2 text-[10px] font-semibold uppercase tracking-[.2em] text-sidebar-foreground/45">Workspace</div>
          <nav className="mt-3 space-y-1" aria-label="Primary navigation">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileNav(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${pathname === href || (href !== '/' && pathname.startsWith(href)) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-4">
            <div className="flex items-center gap-2 text-sidebar-foreground/60"><CalendarDays size={14} /><span className="text-[11px]">Active school</span></div>
            <p className="mt-2 truncate text-sm font-medium">{schoolId ?? 'None selected'}</p>
            <Link href="/school" className="mt-2 block text-[10px] text-sidebar-foreground/60 hover:text-sidebar-foreground">Manage in School setup →</Link>
          </div>
        </div>
      </aside>
      {mobileNav && <button type="button" aria-label="Close menu overlay" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" data-testid="button-menu-overlay" />}
      <main className="min-w-0 flex-1">
        <header className="flex h-[76px] items-center justify-between border-b border-border/70 px-5 md:px-10">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-muted-foreground md:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span data-testid="text-breadcrumb-name">{schoolName}</span><span className="text-border">/</span><span className="text-foreground">Live data from your API</span></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" data-testid="avatar-user">RZ</div>
          </div>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}
