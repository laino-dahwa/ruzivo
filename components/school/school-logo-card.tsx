'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useToast } from '../../app/components/hooks/use-toast';
import { useSchoolLogo } from '../../lib/client/use-school-logo';
import { logoApi, schoolLogoUrl } from '../../services/logo';
import { ConfirmDialog } from '../shared/confirm-dialog';

/**
 * Uploads the school's logo and shows what it will look like at icon sizes.
 *
 * The preview is drawn at the sizes the browser tab and taskbar actually use,
 * because a mark that reads well at 256px can turn to mud at 16px, and that is
 * only obvious when you see it small.
 */
export function SchoolLogoCard({ schoolId }: { schoolId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasLogo, stamp } = useSchoolLogo(schoolId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['school-logo', schoolId] });

  const upload = useMutation({
    mutationFn: (file: File) => logoApi.upload(schoolId, file),
    onSuccess: () => {
      toast({ title: 'Logo updated' });
      refresh();
    },
    onError: (error) => toast({ title: 'Could not save the logo', description: (error as Error).message, variant: 'destructive' }),
    onSettled: () => {
      // Cleared either way, so choosing the same file twice still fires change.
      if (fileInput.current) fileInput.current.value = '';
    },
  });

  const remove = useMutation({
    mutationFn: () => logoApi.remove(schoolId),
    onSuccess: () => {
      toast({ title: 'Logo removed' });
      setConfirmRemove(false);
      refresh();
    },
    onError: (error) => {
      toast({ title: 'Could not remove the logo', description: (error as Error).message, variant: 'destructive' });
      setConfirmRemove(false);
    },
  });

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'image/png') {
      toast({ title: 'Choose a PNG', description: 'The logo must be a PNG so it can be turned into an icon.', variant: 'destructive' });
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    upload.mutate(file);
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <h3 className="text-sm font-semibold">School logo</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        A square PNG works best. It becomes the browser tab icon, the app icon on the taskbar, the mark in the
        sidebar, and the logo on every report.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-5">
        <div className="flex items-end gap-3">
          {hasLogo ? [16, 32, 64].map((size) => (
            <div key={size} className="text-center">
              <div className="flex items-center justify-center rounded-lg border border-border/60 bg-background p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- served from an API route, not a static asset */}
                <img
                  src={schoolLogoUrl(schoolId, { size: size === 64 ? 64 : size, stamp })}
                  alt={`Logo at ${size} pixels`}
                  width={size}
                  height={size}
                  style={{ width: size, height: size }}
                  className="object-contain"
                />
              </div>
              <span className="mt-1 block text-[10px] text-muted-foreground">{size}px</span>
            </div>
          )) : (
            <div className="flex h-[68px] w-[120px] items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30 text-[11px] text-muted-foreground">
              No logo yet
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/png"
            className="hidden"
            data-testid="input-school-logo"
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            data-testid="button-choose-logo"
            className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            <ImageUp size={14} />{upload.isPending ? 'Saving…' : hasLogo ? 'Replace logo' : 'Upload logo'}
          </button>
          {hasLogo && (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={remove.isPending}
              data-testid="button-remove-logo"
              className="flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-60"
            >
              <Trash2 size={14} />Remove
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this logo?"
        description="The tab, taskbar and reports go back to the default Ruzivo mark."
        confirmLabel="Remove"
        pending={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
