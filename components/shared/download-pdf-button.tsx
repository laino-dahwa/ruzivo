'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';

/**
 * The one PDF download control used by every table in the app. Styling and
 * behaviour (pending label, success/failure toast) match the Reports section's
 * original button, so exports look and feel the same everywhere.
 */
export function DownloadPdfButton({
  label = 'Download PDF',
  onDownload,
  disabled = false,
}: {
  label?: string;
  onDownload: () => Promise<void>;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleClick = async () => {
    setDownloading(true);
    try {
      await onDownload();
      toast({ title: 'PDF downloaded' });
    } catch (error) {
      toast({ title: 'Could not generate PDF', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || downloading}
      className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
    >
      <Download size={14} />{downloading ? 'Preparing…' : label}
    </button>
  );
}
