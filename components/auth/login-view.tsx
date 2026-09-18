'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';
import { authApi } from '../../services/auth';
import { LANDING_ROUTE } from '../../lib/auth/permissions';
import { AuthCard } from './auth-card';

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
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

  return (
    <AuthCard title="Sign in" detail="Use the email address your administrator gave you.">
      <form onSubmit={submit} className="space-y-4">
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
          <input
            id="password"
            type="password"
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

        <p className="text-center text-[11px] text-muted-foreground">
          Forgotten your password? An administrator can reset it for you in School setup.
        </p>
      </form>
    </AuthCard>
  );
}
