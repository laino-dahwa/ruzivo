'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, LogIn } from 'lucide-react';
import { authApi, type Actor } from '../../services/auth';
import { LANDING_ROUTE } from '../../lib/auth/permissions';
import { MIN_PASSWORD_LENGTH } from '../../lib/auth/passwordPolicy';
import { PasswordInput } from '../shared/password-input';
import { AuthCard } from './auth-card';
import { SecurityKeyReveal } from './security-key-reveal';

type Mode = 'sign-in' | 'recover';

export function LoginView() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [securityKey, setSecurityKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // After a recovery: the replacement key to show once, and where to go next.
  const [recovered, setRecovered] = useState<{ key: string; actor: Actor } | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword('');
    setSecurityKey('');
    setNewPassword('');
    setConfirm('');
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const actor = await authApi.login(email, password);
      // A first sign-in with an issued temporary password goes straight to
      // choosing a real one; everyone else lands on their own home page.
      router.replace(actor.must_change_password ? '/change-password' : LANDING_ROUTE[actor.access_level]);
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.');
      setPending(false);
    }
  }

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const { security_key, ...actor } = await authApi.recover(email, securityKey, newPassword);
      setRecovered({ key: security_key, actor });
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : 'Recovery failed.');
    } finally {
      setPending(false);
    }
  }

  if (recovered) {
    return (
      <AuthCard title="Password changed" detail="You're signed in, and every other device has been signed out.">
        <SecurityKeyReveal
          securityKey={recovered.key}
          intro="Your old security key has been used up. This is your new one — keep it for next time."
          onContinue={() => {
            router.replace(LANDING_ROUTE[recovered.actor.access_level]);
            router.refresh();
          }}
        />
      </AuthCard>
    );
  }

  if (mode === 'recover') {
    return (
      <AuthCard title="Reset your password" detail="Use the security key you saved to choose a new password.">
        <form onSubmit={recover} className="space-y-4">
          <div>
            <label htmlFor="recover-email" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
            <input id="recover-email" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jdoe@school.school" className="field h-10 text-sm" data-testid="input-recover-email" />
          </div>

          <div>
            <label htmlFor="security-key" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Security key</label>
            <input id="security-key" autoComplete="off" spellCheck={false} required value={securityKey} onChange={(e) => setSecurityKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className="field h-10 font-mono text-sm uppercase tracking-wide" data-testid="input-security-key" />
          </div>

          <div>
            <label htmlFor="recover-new-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">New password</label>
            <PasswordInput id="recover-new-password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="field h-10 text-sm" data-testid="input-recover-new-password" />
            <p className="mt-1 text-[11px] text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters.</p>
          </div>

          <div>
            <label htmlFor="recover-confirm" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Confirm new password</label>
            <PasswordInput id="recover-confirm" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field h-10 text-sm" data-testid="input-recover-confirm" />
          </div>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-recover-error">{error}</p>}

          <button type="submit" disabled={pending} className="button-lift flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-recover">
            <KeyRound size={15} />
            {pending ? 'Checking…' : 'Set new password'}
          </button>

          <button type="button" onClick={() => switchMode('sign-in')} className="w-full text-center text-[11px] text-muted-foreground underline hover:text-foreground" data-testid="button-back-to-sign-in">
            Back to sign in
          </button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" detail="Use the email address your administrator gave you.">
      <form onSubmit={signIn} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jdoe@school.school"
            className="field h-10 text-sm"
            data-testid="input-email"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Password</label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field h-10 text-sm"
            data-testid="input-password"
          />
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-login-error">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="button-lift flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
          data-testid="button-sign-in"
        >
          <LogIn size={15} />
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="space-y-1 text-center text-[11px] text-muted-foreground">
          <p>
            Forgotten your password?{' '}
            <button type="button" onClick={() => switchMode('recover')} className="font-semibold text-foreground underline" data-testid="button-use-security-key">
              Use your security key
            </button>
          </p>
          <p>No key? An administrator can reset it for you in School setup.</p>
        </div>
      </form>
    </AuthCard>
  );
}
