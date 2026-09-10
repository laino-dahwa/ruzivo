export const LOGO_SIZES = [16, 32, 48, 64, 128, 256] as const;

export type LogoRendition = { size: number; png: string };

/**
 * Scales a chosen PNG down to each icon size, in the browser.
 *
 * The scaling happens here rather than on the server so the app needs no image
 * library at all — and specifically no native one, which the desktop build
 * would then have to unpack next to the Postgres binaries. Canvas already has a
 * good downscaler, and the renderer in Electron is the same engine.
 *
 * Every rendition is drawn onto a transparent square: a logo that is not itself
 * square is letterboxed rather than stretched, because an icon slot is square
 * and distorting a school's mark to fill it looks broken.
 */
export async function buildLogoRenditions(file: File): Promise<{ original: string; renditions: LogoRendition[] }> {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);

  const renditions: LogoRendition[] = [];
  for (const size of LOGO_SIZES) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) continue;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    const scale = Math.min(size / image.width, size / image.height);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);

    renditions.push({ size, png: canvas.toDataURL('image/png') });
  }

  return { original, renditions };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not an image the browser can read.'));
    image.src = dataUrl;
  });
}
