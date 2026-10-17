'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { authApi } from '../../services/auth';
import type { ShellActor } from './app-shell';

function initials(actor: ShellActor): string {
  return `${actor.first_name.slice(0, 1)}${actor.last_name.slice(0, 1)}`.toUpperCase() || 'SS';
}

const ACCESS_LABEL: Record<ShellActor['access_level'], string> = {
  ADMIN: 'Administrator',
  CASHIER: 'Cashier',
};

/**
 * Who is signed in, and the two things they can do about it. Replaces the
 * old header chip, which only ever showed the school id.
 */
export function UserMenu({ actor }: { actor: ShellActor }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await authApi.logout();
    } finally {
      // Even a failed sign-out sends them to the sign-in screen: the session
      // may well be gone already, and stranding them here helps nobody.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-secondary"
        aria-expanded={open}
        aria-haspopup="menu"
        data-testid="button-user-menu"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" data-testid="avatar-user">
          {initials(actor)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[11px] font-semibold leading-tight text-foreground">{actor.first_name} {actor.last_name}</span>
          <span className="block text-[10px] leading-tight text-muted-foreground">{ACCESS_LABEL[actor.access_level]}</span>
        </span>
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border/80 bg-card p-1.5 shadow-lg" role="menu">
            <div className="px-2.5 py-2">
              <p className="truncate text-xs font-semibold text-foreground">{actor.first_name} {actor.last_name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{actor.email}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{ACCESS_LABEL[actor.access_level]} · {actor.active_school_id}</p>
            </div>
            <div className="my-1 h-px bg-border/70" />
            <Link
              href="/change-password"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground hover:bg-secondary"
              role="menuitem"
              data-testid="link-change-password"
            >
              <KeyRound size={14} />Change password
            </Link>
            <Link
              href="/security-key"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground hover:bg-secondary"
              role="menuitem"
              data-testid="link-security-key"
            >
              <ShieldCheck size={14} />Security key
            </Link>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-foreground hover:bg-secondary disabled:opacity-60"
              role="menuitem"
              data-testid="button-sign-out"
            >
              <LogOut size={14} />{signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
