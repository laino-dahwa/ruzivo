import { request } from './http';
import { buildLogoRenditions } from '../lib/client/logo-renditions';

/**
 * The URL a logo is served from. `stamp` is the logo's updated_at, so replacing
 * a logo changes the URL and browsers (and the taskbar) pick the new one up
 * instead of holding the cached image.
 */
export function schoolLogoUrl(
  schoolId: string,
  options: { size?: number; ico?: boolean; stamp?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (options.size) params.set('size', String(options.size));
  if (options.ico) params.set('format', 'ico');
  if (options.stamp) params.set('v', options.stamp);
  const query = params.toString();
  return `/api/schools/${encodeURIComponent(schoolId)}/logo${query ? `?${query}` : ''}`;
}

export const logoApi = {
  /** Resizes in the browser, then stores the original and every rendition. */
  upload: async (schoolId: string, file: File) => {
    const { original, renditions } = await buildLogoRenditions(file);
    return request<{ ok: true; stamp: string | null }>(`/api/schools/${encodeURIComponent(schoolId)}/logo`, {
      method: 'POST',
      body: JSON.stringify({ original, renditions }),
    });
  },
  remove: (schoolId: string) =>
    request<{ ok: true }>(`/api/schools/${encodeURIComponent(schoolId)}/logo`, { method: 'DELETE' }),
};
