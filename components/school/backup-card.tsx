'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, HardDriveDownload, RotateCcw } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import type { BackupBridge, BackupCounts, BackupCreated, BackupSelection } from '../../lib/platform';
import { FormDialog } from '../shared/form-dialog';
import { reloadToSignIn, useBackupBridge } from '../shared/use-backup-bridge';

type Created = Extract<BackupCreated, { ok: true }>;
type Selected = Extract<BackupSelection, { ok: true }>;

const COUNT_LABELS: [keyof BackupCounts, string][] = [
  ['schools', 'Schools'],
  ['learners', 'Learners'],
  ['payments', 'Payments'],
  ['expenses', 'Expenses'],
  ['employees', 'Staff accounts'],
  ['payrollRuns', 'Payroll runs'],
];

/** Backups older than this get an amber nudge instead of a green tick. */
const STALE_AFTER_DAYS = 7;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(iso: string, now: Date = new Date(iso)): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Backup & restore, at the top of the Setup page. Desktop only: the work is
 * done by the desktop app's main process (electron/backup/), which is the
 * only part of Ruzivo that can write folders on this computer.
 */
export function BackupCard() {
  const bridge = useBackupBridge();

  if (!bridge) {
    return (
      <div className="rounded-2xl border border-border/80 bg-card p-5" data-testid="card-backup">
        <h3 className="text-sm font-semibold">Backup &amp; restore</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Backups are made from the Ruzivo desktop app, which can save them to a folder on the computer, a USB stick or a synced cloud folder. Open the desktop app to back up or restore.
        </p>
      </div>
    );
  }
  return <DesktopBackupCard bridge={bridge} />;
}

function DesktopBackupCard({ bridge }: { bridge: BackupBridge }) {
  const { toast } = useToast();
  // The time of the check is taken with the answer, so "18 hours ago" and
  // the staleness nudge never depend on when React happens to re-render.
  const status = useQuery({
    queryKey: ['backup-status'],
    queryFn: async () => ({ result: await bridge.status(), checkedAt: new Date() }),
  });
  const [working, setWorking] = useState<'backup' | 'choose' | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  const result = status.data?.result;
  const checkedAt = status.data?.checkedAt;
  const data = result?.ok ? result : null;
  const last = data?.lastBackup ?? null;
  const stale = !last || !checkedAt || checkedAt.getTime() - new Date(last.createdAt).getTime() > STALE_AFTER_DAYS * 86400000;

  const backUp = async () => {
    setWorking('backup');
    try {
      const result = await bridge.create();
      if (result.ok) {
        setCreated(result);
        void status.refetch();
      } else if (!result.canceled) {
        toast({ title: 'Backup failed', description: result.error, variant: 'destructive' });
      }
    } finally {
      setWorking(null);
    }
  };

  const chooseBackup = async () => {
    setWorking('choose');
    try {
      const result = await bridge.choose('admin');
      if (result.ok) setSelected(result);
      else if (!result.canceled) toast({ title: "Can't restore that folder", description: result.error, variant: 'destructive' });
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-6" data-testid="card-backup">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-sm font-semibold">Backup &amp; restore</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            A backup is one folder holding <span className="font-semibold text-foreground">everything in Ruzivo on this computer</span>: every school, learner, payment, expense, staff account and payroll run. Save it somewhere that isn&apos;t this computer, such as a USB stick or a OneDrive or Google Drive folder.
          </p>
        </div>
        {data && (
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[10.5px] font-bold ${stale ? 'bg-accent/40 text-accent-foreground' : 'bg-[hsl(145_25%_38%/.14)] text-[hsl(145_25%_32%)]'}`}
            data-testid="backup-freshness"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {last ? `Backed up ${timeAgo(last.createdAt, checkedAt)}` : 'Never backed up'}
          </span>
        )}
      </div>

      {result && !result.ok && <p className="mt-3 text-xs text-destructive">{result.error}</p>}

      <div className="mt-5 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Last backup</p>
          <div className="rounded-[10px] border border-border/70 bg-background/60 px-3.5 py-3 text-xs">
            {last ? (
              <>
                <Row label="When" value={fullDate(last.createdAt)} />
                <Row label="Made by" value={last.createdBy ?? '—'} />
                <Row label="Size" value={`${formatBytes(last.sizeBytes)} · ${last.tables} tables`} />
                <p className="mt-2 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">{last.path}</p>
              </>
            ) : (
              <p className="text-muted-foreground">{status.isLoading ? 'Loading…' : 'No backup has been made on this computer yet.'}</p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" onClick={backUp} disabled={working !== null} data-testid="button-backup-now" className="button-lift flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">
              <HardDriveDownload size={15} />{working === 'backup' ? 'Backing up…' : 'Back up now…'}
            </button>
            {last && (
              <button type="button" onClick={() => void bridge.showLast()} className="button-lift flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold">
                <FolderOpen size={15} />Show last backup
              </button>
            )}
          </div>
        </div>

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What a backup contains right now</p>
          <div className="grid grid-cols-3 gap-2.5">
            {COUNT_LABELS.map(([key, label]) => (
              <div key={key} className="rounded-[10px] border border-border/70 bg-background/60 px-3 py-2.5">
                <p className="text-base font-semibold tracking-[-.03em]">{data ? data.counts[key].toLocaleString() : '—'}</p>
                <p className="text-[10.5px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-muted-foreground">Also included: logos, fees and periods, issued documents and the activity log. Not included: who is signed in right now.</p>
        </div>
      </div>

      <div className="my-5 h-px bg-border/70" />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-[13px] font-semibold">Restore from a backup</p>
          <p className="mt-0.5 max-w-2xl text-[11px] text-muted-foreground">Replaces everything in Ruzivo on this computer with the contents of a backup folder. Ruzivo saves a safety copy of the current data first, so a restore can be undone.</p>
        </div>
        <button type="button" onClick={chooseBackup} disabled={working !== null} data-testid="button-restore-backup" className="button-lift flex h-10 shrink-0 items-center gap-2 rounded-lg border border-destructive/50 px-4 text-xs font-semibold text-destructive disabled:opacity-60">
          <RotateCcw size={14} />{working === 'choose' ? 'Checking backup…' : 'Restore from a backup…'}
        </button>
      </div>

      {created && <BackupSavedDialog created={created} onClose={() => setCreated(null)} onShow={() => void bridge.showLast()} />}
      {selected && <RestoreDialog bridge={bridge} selection={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function BackupSavedDialog({ created, onClose, onShow }: { created: Created; onClose: () => void; onShow: () => void }) {
  const rows = (name: string) => created.tables.find((t) => t.name === name)?.rows ?? 0;
  const shown = ['schools', 'learners', 'payments'];
  return (
    <FormDialog open title="Backup saved" description="Every file was written, read back, and checked against its fingerprint." onClose={onClose}>
      <div className="space-y-4 pb-5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(145_25%_38%/.14)] px-2.5 py-1 font-bold text-[hsl(145_25%_32%)]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />Verified · {created.tables.length} of {created.tables.length} tables
          </span>
          <span>Took {Math.max(1, Math.round(created.durationMs / 1000))} second{created.durationMs >= 1500 ? 's' : ''} · {formatBytes(created.sizeBytes)}</span>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saved to</p>
          <p className="break-all rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px]" data-testid="text-backup-path">{created.path}</p>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What&apos;s in the folder</p>
          <div className="rounded-[10px] border border-border/70 bg-background/60 px-3 py-2.5 text-xs tabular-nums">
            <FileRow name="manifest.json" note="Version, date, row counts, fingerprints" />
            <FileRow name="README.txt" note="How to restore, in plain words" />
            <FileRow name="Ruzivo data (read-only copy).xlsx" note="For opening in Excel" />
            <FileRow name="data" note={`One file per table · ${created.tables.length} files`} folder />
            {shown.map((name) => <FileRow key={name} name={`${name}.jsonl`} note={`${rows(name).toLocaleString()} rows`} nested />)}
            <p className="py-0.5 pl-11 text-muted-foreground">… {created.tables.length - shown.length} more</p>
          </div>
        </div>
        <p className="text-xs leading-5"><span className="font-semibold">Keep a copy away from this computer.</span> A backup on the same disk won&apos;t help if the computer is stolen or the disk fails.</p>
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onShow} className="button-lift flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold"><FolderOpen size={15} />Show in folder</button>
          <button type="button" onClick={onClose} className="button-lift h-10 rounded-lg bg-primary px-5 text-xs font-semibold text-primary-foreground">Done</button>
        </div>
      </div>
    </FormDialog>
  );
}

function FileRow({ name, note, folder, nested }: { name: string; note: string; folder?: boolean; nested?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-0.5 ${nested ? 'pl-11' : 'pl-5'}`}>
      <span className="flex items-center gap-2">
        {folder ? <span className="inline-block h-3 w-3.5 rounded-sm bg-accent" /> : <span className="inline-block h-3.5 w-3 rounded-sm border border-muted-foreground/70" />}
        {name}
      </span>
      <span className="text-right text-muted-foreground">{note}</span>
    </div>
  );
}

function RestoreDialog({ bridge, selection, onClose }: { bridge: BackupBridge; selection: Selected; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { backup, current } = selection;
  const since = current.newerSinceBackup;
  const lost = [
    since.payments > 0 ? `${since.payments.toLocaleString()} payment${since.payments === 1 ? '' : 's'}` : null,
    since.learners > 0 ? `${since.learners.toLocaleString()} learner${since.learners === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  const backupTime = new Date(backup.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setRestoring(true);
    setError(null);
    const result = await bridge.restore({ selectionId: selection.selectionId, password, mode: 'admin' });
    if (result.ok) {
      // Every session, this one included, ended with the restore.
      reloadToSignIn();
      return;
    }
    setRestoring(false);
    setError(result.error);
  };

  return (
    <FormDialog open width="xl" title="Restore from this backup?" description="The folder was checked: it's a complete Ruzivo backup and none of its files have been changed." onClose={restoring ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4 pb-5">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Backup folder</p>
          <p className="break-all rounded-md bg-muted px-2.5 py-2 font-mono text-[11.5px]">{selection.path}</p>
        </div>

        <div className="grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-[10px] border border-border/70 bg-background/60 p-3 text-xs">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">On this computer now</p>
            <Row label="Schools" value={current.counts.schools.toLocaleString()} />
            <Row label="Learners" value={current.counts.learners.toLocaleString()} />
            <Row label="Payments" value={current.counts.payments.toLocaleString()} />
            <Row label="Last payment" value={current.lastPaymentAt ? new Date(current.lastPaymentAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} />
          </div>
          <div className="hidden items-center text-muted-foreground sm:flex">→</div>
          <div className="rounded-[10px] border border-primary/50 bg-primary/5 p-3 text-xs">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-primary">In the backup · {backupTime}</p>
            <Row label="Schools" value={backup.schools.map((s) => s.school_name).join(', ') || '—'} />
            <Row label="Learners" value={backup.counts.learners.toLocaleString()} />
            <Row label="Payments" value={backup.counts.payments.toLocaleString()} />
            <Row label="Made with" value={`Ruzivo ${backup.appVersion}`} />
          </div>
        </div>

        <div className="rounded-[10px] border border-destructive/35 bg-destructive/5 px-3.5 py-3 text-xs leading-5">
          <span className="font-semibold text-destructive">Everything on this computer will be replaced.</span>{' '}
          {lost.length > 0 && <>{lost.join(' and ')} recorded since {backupTime} {lost.length === 1 && !lost[0]!.endsWith('s') ? 'is' : 'are'} not in this backup and will no longer show. </>}
          Ruzivo saves a safety copy of today&apos;s data first, in the app&apos;s backups folder, so this can be undone by restoring that copy. Everyone, including you, will need to sign in again with the passwords from the backup.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="restore-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Your password</label>
            <input id="restore-password" type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="field" data-testid="input-restore-password" />
          </div>
          <div>
            <label htmlFor="restore-confirm" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type RESTORE to confirm</label>
            <input id="restore-confirm" required value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className="field" autoComplete="off" data-testid="input-restore-confirm" />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={restoring} className="button-lift h-10 rounded-lg border border-border bg-background px-4 text-xs font-semibold disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={restoring || confirmText.trim() !== 'RESTORE' || !password} data-testid="button-confirm-restore" className="button-lift h-10 rounded-lg bg-destructive px-4 text-xs font-semibold text-destructive-foreground disabled:opacity-50">
            {restoring ? 'Restoring… do not close Ruzivo' : 'Replace my data with this backup'}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
