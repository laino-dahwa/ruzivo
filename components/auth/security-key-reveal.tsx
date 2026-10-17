'use client';

import { useState } from 'react';
import { Copy, ShieldCheck } from 'lucide-react';

/**
 * Shows a security key exactly once. It is stored only as a hash, so this
 * screen is the one chance to keep it — hence Continue stays disabled until
 * the user confirms they have saved it.
 */
export function SecurityKeyReveal({
  securityKey,
  intro,
  continueLabel = 'Continue',
  onContinue,
}: {
  securityKey: string;
  intro: string;
  continueLabel?: string;
  onContinue: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(securityKey);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <div className="space-y-4" data-testid="panel-security-key">
      <p className="text-xs text-muted-foreground">{intro}</p>

      <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck size={13} />Your security key
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 select-all break-all rounded-md bg-background px-2 py-1.5 font-mono text-sm tracking-wide" data-testid="text-security-key">
            {securityKey}
          </code>
          <button type="button" onClick={copy} title="Copy key" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Copy size={15} />
          </button>
        </div>
        {copied === 'yes' && <p className="mt-1 text-[11px] text-primary">Copied.</p>}
        {copied === 'failed' && <p className="mt-1 text-[11px] text-destructive">Could not copy — select it and copy it by hand.</p>}
      </div>

      <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
        <li>Write it down or print it, and keep it somewhere safe and private.</li>
        <li>It is shown only now — it cannot be looked up again.</li>
        <li>Anyone with your email and this key can set a new password for your account.</li>
      </ul>

      <label className="flex items-center gap-2 text-xs text-foreground">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="checkbox-security-key-saved" />
        I&rsquo;ve saved this key somewhere safe
      </label>

      <button
        type="button"
        disabled={!saved}
        onClick={onContinue}
        className="button-lift flex h-10 w-full items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"
        data-testid="button-security-key-continue"
      >
        {continueLabel}
      </button>
    </div>
  );
}
