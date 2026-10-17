'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { authApi } from '../../services/auth';
import { AuthCard } from './auth-card';
import { SecurityKeyReveal } from './security-key-reveal';

/**
 * Make (or replace) your own security key — the way back in from the sign-in
 * screen if you forget your password. Asks for your current password first,
 * since a key is a second way into the account.
 */
export function SecurityKeyView() {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['security-key-status'], queryFn: authApi.securityKeyStatus });
  const hasKey = !!status.data?.has_key;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { security_key } = await authApi.createSecurityKey(current);
      setNewKey(security_key);
      setCurrent('');
      queryClient.invalidateQueries({ queryKey: ['security-key-status'] });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not make a security key.');
    } finally {
      setPending(false);
    }
  }

  if (newKey) {
    return (
      <AuthCard title="Your new security key" detail={hasKey ? 'Any earlier key no longer works.' : 'Keep it somewhere safe.'}>
        <SecurityKeyReveal
          securityKey={newKey}
          intro="If you forget your password, choose “Use your security key” on the sign-in screen and enter this key to set a new one."
          continueLabel="Done"
          onContinue={() => setNewKey(null)}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Security key" detail="Your way back in if you forget your password.">
      <div className="mb-4 rounded-lg border border-border/70 bg-secondary/30 p-3 text-xs" data-testid="text-security-key-status">
        {status.isLoading ? (
          'Checking…'
        ) : hasKey ? (
          <>
            You have a security key
            {status.data?.created_at && <> made on {new Date(status.data.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</>}.
            Making a new one replaces it.
          </>
        ) : (
          'You don’t have a security key yet. Without one, only an administrator can reset your password.'
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="security-key-current" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Current password</label>
          <input id="security-key-current" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className="field h-10 text-sm" data-testid="input-security-key-current-password" />
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-security-key-error">{error}</p>}

        <button type="submit" disabled={pending} className="button-lift flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-make-security-key">
          <ShieldCheck size={15} />
          {pending ? 'Making…' : hasKey ? 'Replace my security key' : 'Make my security key'}
        </button>

        <Link href="/" className="block text-center text-[11px] text-muted-foreground underline hover:text-foreground">Back to the app</Link>
      </form>
    </AuthCard>
  );
}
