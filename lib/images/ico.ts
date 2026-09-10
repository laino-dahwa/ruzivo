/**
 * Assembles a Windows .ico from a set of square PNGs.
 *
 * Since Vista, an icon directory entry may point at a PNG rather than a device-
 * independent bitmap, so building one is a matter of writing the directory and
 * concatenating the PNG bytes — no image library, and in particular no native
 * binary that the Electron packaging would then have to unpack.
 *
 * Layout: a 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the
 * image data.
 */

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;

/** The PNG magic number, so a non-PNG never reaches the icon directory. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type IconSource = { size: number; png: Buffer };

export function isPng(data: Buffer): boolean {
  return data.length > PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * Reads a PNG's pixel dimensions from its IHDR chunk, which always begins at
 * byte 16. Used to check an upload is square and sane before anything is
 * stored.
 */
export function pngDimensions(data: Buffer): { width: number; height: number } | null {
  if (!isPng(data) || data.length < 24) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

export function buildIco(sources: IconSource[]): Buffer {
  const images = sources
    .filter((source) => isPng(source.png) && source.size >= 1 && source.size <= 256)
    // Windows scans the directory in order; smallest first is conventional.
    .sort((a, b) => a.size - b.size);

  if (images.length === 0) {
    throw new Error('An icon needs at least one PNG.');
  }

  const header = Buffer.alloc(ICONDIR_SIZE);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(ICONDIRENTRY_SIZE * images.length);
  let offset = ICONDIR_SIZE + directory.length;

  images.forEach((image, index) => {
    const at = index * ICONDIRENTRY_SIZE;
    // 256 is written as 0: the field is one byte, so 256 does not fit.
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at);
    directory.writeUInt8(image.size === 256 ? 0 : image.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size; 0 for truecolour
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.png.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}
