'use client';

import { useEffect } from 'react';
import { getDesktopBridge } from '../../lib/platform';
import { useToast } from '../../app/components/hooks/use-toast';
import { ToastAction } from '../../app/components/ui/toast';

/**
 * Renders nothing on the web — getDesktopBridge() returns null there. Inside
 * Electron, surfaces electron-updater's progress as toasts, ending in a
 * "Restart now" action once the update has finished downloading.
 */
export function UpdateNotice() {
  const { toast } = useToast();

  useEffect(() => {
    const desktop = getDesktopBridge();
    if (!desktop) return;

    return desktop.onUpdateStatus((status) => {
      switch (status.state) {
        case 'available':
          toast({ title: 'Update available', description: `Downloading version ${status.version}…` });
          break;
        case 'downloaded':
          toast({
            title: 'Update ready',
            description: `Version ${status.version} has been downloaded.`,
            action: (
              <ToastAction altText="Restart now" onClick={() => desktop.installUpdate()}>
                Restart now
              </ToastAction>
            ),
          });
          break;
        case 'error':
          toast({ title: 'Update check failed', description: status.message, variant: 'destructive' });
          break;
        default:
          break;
      }
    });
  }, [toast]);

  return null;
}
