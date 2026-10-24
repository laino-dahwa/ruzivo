'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { authApi, type NewSchoolInput } from '../../services/auth';
import { MIN_PASSWORD_LENGTH } from '../../lib/auth/passwordPolicy';
import { useBackupBridge } from '../shared/use-backup-bridge';
import { AuthCard } from './auth-card';
import { FirstRunChoice } from './first-run-restore';
import { SecurityKeyReveal } from './security-key-reveal';

const EMPTY_SCHOOL: NewSchoolInput = {
  school_id: '',
  school_name: '',
  school_type: 'primary',
  school_address: '',
  school_contact: '',
  school_email: '',
};

/**
 * The one-time screen that creates the first administrator.
 *
 * There is no default password anywhere in the app — this is where the first
 * credential comes from, and the endpoint behind it refuses to run once an
 * administrator exists.
 */
export function SetupView() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [newSchool, setNewSchool] = useState<NewSchoolInput>(EMPTY_SCHOOL);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The first administrator's security key, shown once before continuing.
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [startFresh, setStartFresh] = useState(false);
  const backupBridge = useBackupBridge();

  const availability = useQuery({ queryKey: ['setup-availability'], queryFn: authApi.setupAvailability });

  const schools = availability.data?.schools ?? [];
  const mustCreateSchool = availability.isSuccess && schools.length === 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    try {
      const created = await authApi.bootstrap({
        first_name: firstName,
        last_name: lastName,
        password,
        ...(mustCreateSchool ? { new_school: newSchool } : { school_id: schoolId || schools[0]?.school_id }),
      });
      // Bootstrap signs them in; the security key is shown before moving on.
      setCreatedKey(created.security_key);
      setPending(false);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Setup failed.');
      setPending(false);
    }
  }

  if (createdKey) {
    return (
      <AuthCard title="Save your security key" detail="Your administrator account is ready.">
        <SecurityKeyReveal
          securityKey={createdKey}
          intro="If you ever forget your password, this key lets you set a new one from the sign-in screen — even if you are the only administrator."
          continueLabel="Go to the app"
          onContinue={() => {
            router.replace('/');
            router.refresh();
          }}
        />
      </AuthCard>
    );
  }

  if (availability.isLoading) {
    return <AuthCard title="Setting up" detail="Checking whether this app has an administrator yet."><p className="text-xs text-muted-foreground">Loading…</p></AuthCard>;
  }

  // A desktop install with nothing on it yet first offers to bring a backup
  // across from another computer, before anyone creates a fresh account.
  if (availability.data?.available && backupBridge && !startFresh) {
    return <FirstRunChoice bridge={backupBridge} onStartFresh={() => setStartFresh(true)} />;
  }

  if (availability.data && !availability.data.available) {
    return (
      <AuthCard title="Already set up" detail="This app already has an administrator.">
        <p className="text-xs text-muted-foreground">
          Setup can only run once. Sign in instead, or ask your administrator to create an account for you.
        </p>
        <a href="/login" className="button-lift mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">Go to sign in</a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your administrator account" detail="This runs once, and there is no default password — you choose it here.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="first-name" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">First name</label>
            <input id="first-name" required autoFocus value={firstName} onChange={(e) => setFirstName(e.target.value)} className="field h-10 text-sm" data-testid="input-first-name" />
          </div>
          <div>
            <label htmlFor="last-name" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last name</label>
            <input id="last-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} className="field h-10 text-sm" data-testid="input-last-name" />
          </div>
        </div>

        {mustCreateSchool ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-secondary/30 p-3">
            <p className="text-[11px] text-muted-foreground">There are no schools yet, so set yours up at the same time.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="school-id" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">School ID</label>
                <input id="school-id" required maxLength={4} value={newSchool.school_id} onChange={(e) => setNewSchool((s) => ({ ...s, school_id: e.target.value.toUpperCase() }))} placeholder="SSV" className="field h-10 text-sm" data-testid="input-school-id" />
              </div>
              <div>
                <label htmlFor="school-name" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">School name</label>
                <input id="school-name" required value={newSchool.school_name} onChange={(e) => setNewSchool((s) => ({ ...s, school_name: e.target.value }))} className="field h-10 text-sm" data-testid="input-school-name" />
              </div>
            </div>
            <div>
              <label htmlFor="school-email" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">School email</label>
              <input id="school-email" type="email" required value={newSchool.school_email} onChange={(e) => setNewSchool((s) => ({ ...s, school_email: e.target.value }))} className="field h-10 text-sm" data-testid="input-school-email" />
            </div>
          </div>
        ) : (
          <div>
            <label htmlFor="school" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">School</label>
            <select id="school" value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className="field h-10 text-sm" data-testid="select-school">
              {schools.map((school) => (
                <option key={school.school_id} value={school.school_id}>{school.school_name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">You will be able to switch between schools once signed in.</p>
          </div>
        )}

        <div>
          <label htmlFor="new-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Password</label>
          <input id="new-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field h-10 text-sm" data-testid="input-new-password" />
          <p className="mt-1 text-[11px] text-muted-foreground">At least {MIN_PASSWORD_LENGTH} characters. Nobody can recover this for you, so pick something you will remember.</p>
        </div>

        <div>
          <label htmlFor="confirm-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Confirm password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field h-10 text-sm" data-testid="input-confirm-password" />
        </div>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-setup-error">{error}</p>}

        <button type="submit" disabled={pending} className="button-lift flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-create-administrator">
          <ShieldCheck size={15} />
          {pending ? 'Creating…' : 'Create administrator'}
        </button>
      </form>
    </AuthCard>
  );
}
