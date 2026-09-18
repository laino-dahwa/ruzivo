'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { authApi } from '../../services/auth';
import { MIN_PASSWORD_LENGTH } from '../../lib/auth/passwordPolicy';
import { AuthCard } from './auth-card';

export function ChangePasswordView({ forced }: { forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      await authApi.changePassword(current, next);
      router.replace('/');
      router.refresh();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Password change failed.');
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={forced ? 'Choose your password' : 'Change your password'}
      detail={forced ? 'Your account was created with a temporary password. Pick your own to continue.' : 'Signing out every other device.'}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="current-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {forced ? 'Temporary password' : 'Current password'}
          </label>
          <input id="current-password" type="password" autoComplete="current-password" autoFocus required value={current} onChange={(e) => setCurrent(e.target.value)} className="field h-10 text-sm" data-testid="input-current-password" />
        </div>

        <div>
          <label htmlFor="next-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">New password</label>
          <input id="next-password" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className="field h-10 text-sm" data-testid="input-next-password" />
          <p className="mt-1 text-[11px] text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        <div>
          <label htmlFor="confirm-new-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Confirm new password</label>
          <input id="confirm-new-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field h-10 text-sm" data-testid="input-confirm-new-password" />
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-change-password-error">{error}</p>}

        <button type="submit" disabled={pending} className="button-lift flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-change-password">
          <KeyRound size={15} />
          {pending ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthCard>
  );
}
