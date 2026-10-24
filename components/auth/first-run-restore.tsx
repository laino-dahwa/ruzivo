'use client';

import { useState } from 'react';
import type { BackupBridge, BackupSelection } from '../../lib/platform';
import { reloadToSignIn } from '../shared/use-backup-bridge';
import { AuthCard } from './auth-card';

type Selected = Extract<BackupSelection, { ok: true }>;

/**
 * The first screen of a brand-new desktop install: start fresh, or bring
 * everything across from another computer's backup folder. Restoring here
 * needs no sign-in - there is no account yet - and the main process only
 * allows it while the app still has no administrator (electron/backup/ipc.ts).
 */
export function FirstRunChoice({ bridge, onStartFresh }: { bridge: BackupBridge; onStartFresh: () => void }) {
  const [choice, setChoice] = useState<'fresh' | 'restore'>('fresh');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'choose' | 'restore' | null>(null);

  const chooseFolder = async () => {
    setBusy('choose');
    setError(null);
    const result = await bridge.choose('first-run');
    setBusy(null);
    if (result.ok) setSelected(result);
    else if (!result.canceled) setError(result.error);
  };

  const continueOn = async () => {
    if (choice === 'fresh') {
      onStartFresh();
      return;
    }
    if (!selected) return;
    setBusy('restore');
    setError(null);
    const result = await bridge.restore({ selectionId: selected.selectionId, mode: 'first-run' });
    if (result.ok) {
      reloadToSignIn();
      return;
    }
    setBusy(null);
    setError(result.error);
  };

  const option = (value: 'fresh' | 'restore', title: string, detail: string) => (
    <button
      type="button"
      onClick={() => setChoice(value)}
      aria-pressed={choice === value}
      data-testid={`choice-${value}`}
      className={`flex w-full items-start gap-3.5 rounded-xl border p-3.5 text-left transition-colors ${choice === value ? 'border-primary bg-card shadow-[0_0_0_3px_hsl(var(--primary)/.14)]' : 'border-border bg-background/50'}`}
    >
      <span className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${choice === value ? 'border-primary bg-[radial-gradient(hsl(var(--primary))_0_3.5px,transparent_4px)]' : 'border-input'}`} />
      <span>
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </button>
  );

  return (
    <AuthCard title="Welcome to Ruzivo" detail="This computer has no Ruzivo data yet. How would you like to start?">
      <div className="space-y-2.5">
        {option('fresh', 'Start fresh', 'Create your administrator account and your school.')}
        {option('restore', 'Restore from a backup', 'Moving from another computer? Bring everything across, including staff accounts and passwords.')}
      </div>

      {choice === 'restore' && (
        <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-background/50 p-3.5">
          <button type="button" onClick={chooseFolder} disabled={busy !== null} className="button-lift h-9 rounded-lg border border-border bg-background px-3.5 text-xs font-semibold disabled:opacity-60" data-testid="button-choose-backup">
            {busy === 'choose' ? 'Checking backup…' : selected ? 'Choose a different folder…' : 'Choose backup folder…'}
          </button>
          {selected && (
            <div className="rounded-[10px] border border-border/70 bg-card px-3 py-2.5 text-xs">
              <Row label="Folder" value={selected.path.split(/[\\/]/).pop() ?? selected.path} />
              <Row label="Made" value={new Date(selected.backup.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} />
              <Row label="Schools" value={selected.backup.schools.map((s) => s.school_name).join(', ') || '—'} />
              <Row label="Learners · Payments" value={`${selected.backup.counts.learners.toLocaleString()} · ${selected.backup.counts.payments.toLocaleString()}`} />
              <Row label="Check" value="Complete and unchanged ✓" good />
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={continueOn}
        disabled={busy !== null || (choice === 'restore' && !selected)}
        className="button-lift mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
        data-testid="button-first-run-continue"
      >
        {choice === 'fresh' ? 'Continue' : busy === 'restore' ? 'Restoring… do not close Ruzivo' : 'Restore and continue to sign in'}
      </button>
      {choice === 'restore' && <p className="mt-2.5 text-center text-[11px] text-muted-foreground">You&apos;ll sign in with your usual email and password from the old computer.</p>}
    </AuthCard>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right ${good ? 'font-semibold text-[hsl(145_25%_32%)]' : ''}`}>{value}</span>
    </div>
  );
}
