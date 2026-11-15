'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudUpload, Link2, Unlink } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import type { SyncBridge } from '../../lib/platform';
import { FormDialog } from '../shared/form-dialog';
import { useSyncBridge } from '../shared/use-backup-bridge';
import { timeAgo } from './backup-card';

/**
 * Cloud website sync, on the Setup page below Backup & restore. Desktop
 * only: the desktop app's main process (electron/sync/) sends this
 * computer's data to the school's read-only website.
 */
export function SyncCard() {
  const bridge = useSyncBridge();
  if (!bridge) return null;
  return <DesktopSyncCard bridge={bridge} />;
}

function DesktopSyncCard({ bridge }: { bridge: SyncBridge }) {
  const { toast } = useToast();
  const status = useQuery({
    queryKey: ['sync-status'],
    queryFn: async () => ({ result: await bridge.status(), checkedAt: new Date() }),
    refetchInterval: (query) => (query.state.data?.result.ok && query.state.data.result.running ? 3000 : 60000),
  });
  const [syncing, setSyncing] = useState(false);
  const [linking, setLinking] = useState(false);

  const result = status.data?.result;
  const checkedAt = status.data?.checkedAt;
  const data = result?.ok ? result : null;
  const linked = data?.linked ?? null;
  const failing = Boolean(data?.lastError && (!data.lastSuccessAt || (data.lastErrorAt ?? '') > data.lastSuccessAt));

  const syncNow = async () => {
    setSyncing(true);
    try {
      const outcome = await bridge.syncNow();
      if (outcome.ok) {
        const r = outcome.result;
        toast({ title: 'Website up to date', description: r && r.rows > 0 ? `${r.rows.toLocaleString()} change${r.rows === 1 ? '' : 's'} sent${r.mode === 'full' ? ' (full copy)' : ''}.` : 'Nothing new to send.' });
      } else {
        toast({ title: 'Sync failed', description: outcome.error, variant: 'destructive' });
      }
    } finally {
      setSyncing(false);
      void status.refetch();
    }
  };

  const unlink = async () => {
    if (!window.confirm('Stop sending data to the website? What it already shows stays there until another computer is linked.')) return;
    const outcome = await bridge.unlink();
    if (!outcome.ok) toast({ title: 'Could not unlink', description: outcome.error, variant: 'destructive' });
    void status.refetch();
  };

  let badge: { text: string; tone: 'ok' | 'warn' | 'off' };
  if (!linked) badge = { text: 'Not linked', tone: 'off' };
  else if (data?.running || syncing) badge = { text: 'Syncing…', tone: 'ok' };
  else if (failing) badge = { text: 'Not syncing', tone: 'warn' };
  else if (data?.lastSuccessAt) badge = { text: `Synced ${timeAgo(data.lastSuccessAt, checkedAt)}`, tone: 'ok' };
  else badge = { text: 'Waiting for first sync', tone: 'warn' };

  const tone = {
    ok: 'bg-[hsl(145_25%_38%/.14)] text-[hsl(145_25%_32%)]',
    warn: 'bg-accent/40 text-accent-foreground',
    off: 'bg-muted text-muted-foreground',
  }[badge.tone];

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-6" data-testid="card-sync">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="text-sm font-semibold">Cloud website</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
            Sends a copy of <span className="font-semibold text-foreground">everything in Ruzivo on this computer</span> to the school&apos;s read-only website every few minutes, so it can be viewed away from the school. Sign-in passwords and security keys are never sent. Works offline: changes wait here until the internet is back.
          </p>
        </div>
        {data && (
          <span className={`inline-flex shrink-0 items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[10.5px] font-bold ${tone}`} data-testid="sync-state">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {badge.text}
          </span>
        )}
      </div>

      {result && !result.ok && <p className="mt-3 text-xs text-destructive">{result.error}</p>}

      {linked ? (
        <>
          <div className="mt-5 grid gap-x-6 gap-y-1 rounded-[10px] border border-border/70 bg-background/60 px-3.5 py-3 text-xs sm:grid-cols-2">
            <Row label="Website" value={linked.workerUrl} />
            <Row label="Linked by" value={`${linked.linkedBy} · ${new Date(linked.linkedAt).toLocaleDateString()}`} />
            <Row label="Waiting to send" value={data?.needsFullSync ? 'A full copy' : `${(data?.pending ?? 0).toLocaleString()} change${data?.pending === 1 ? '' : 's'}`} />
            <Row label="Last full copy" value={data?.lastFullSyncAt ? timeAgo(data.lastFullSyncAt, checkedAt) : '—'} />
          </div>
          {failing && data?.lastError && (
            <p className="mt-3 rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="sync-error">
              {data.lastError}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" onClick={syncNow} disabled={syncing || data?.running} data-testid="button-sync-now" className="button-lift flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60">
              <CloudUpload size={15} />{syncing || data?.running ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" onClick={unlink} disabled={syncing} className="button-lift flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold disabled:opacity-60">
              <Unlink size={15} />Unlink this computer
            </button>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <button type="button" onClick={() => setLinking(true)} data-testid="button-sync-link" className="button-lift flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground">
            <Link2 size={15} />Link to the website…
          </button>
        </div>
      )}

      {linking && (
        <LinkDialog
          bridge={bridge}
          onClose={() => setLinking(false)}
          onLinked={() => {
            setLinking(false);
            toast({ title: 'Linked', description: 'A full copy of the data is being sent now.' });
            void status.refetch();
          }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right">{value}</span>
    </div>
  );
}

function LinkDialog({ bridge, onClose, onLinked }: { bridge: SyncBridge; onClose: () => void; onLinked: () => void }) {
  const [workerUrl, setWorkerUrl] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    const outcome = await bridge.link({ workerUrl, linkCode, password });
    setWorking(false);
    if (outcome.ok) onLinked();
    else setError(outcome.error);
  };

  return (
    <FormDialog open title="Link to the school website" description="Enter the website's sync address and link code from whoever set the website up." onClose={working ? () => {} : onClose}>
      <form onSubmit={submit} className="space-y-4 pb-5">
        <div>
          <label htmlFor="sync-url" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sync address</label>
          <input id="sync-url" required autoFocus placeholder="https://ruzivo-sync.yourschool.workers.dev" value={workerUrl} onChange={(e) => setWorkerUrl(e.target.value)} className="field" autoComplete="off" data-testid="input-sync-url" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sync-code" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Link code</label>
            <input id="sync-code" required value={linkCode} onChange={(e) => setLinkCode(e.target.value)} className="field" autoComplete="off" data-testid="input-sync-code" />
          </div>
          <div>
            <label htmlFor="sync-password" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Your password</label>
            <input id="sync-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="field" data-testid="input-sync-password" />
          </div>
        </div>
        <div className="rounded-[10px] border border-border/70 bg-background/60 px-3.5 py-3 text-xs leading-5">
          <span className="font-semibold">This sends learners&apos; details, payments and staff salaries to the website.</span> Only link a website the school controls, protected so only the right people can open it. If another computer was linked before, it stops syncing.
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2.5">
          <button type="button" onClick={onClose} disabled={working} className="button-lift h-10 rounded-lg border border-border bg-background px-4 text-xs font-semibold disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={working || !workerUrl || !linkCode || !password} data-testid="button-confirm-sync-link" className="button-lift h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {working ? 'Linking…' : 'Link this computer'}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
