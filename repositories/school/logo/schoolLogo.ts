import { query, transaction } from "../../../lib/db";
import { buildIco, isPng, pngDimensions } from "../../../lib/images/ico";

/** The sizes a browser tab, a taskbar and the in-app marks all draw from. */
export const LOGO_SIZES = [16, 32, 48, 64, 128, 256] as const;

/** 2MB. A logo is a small square mark; anything larger is a photograph. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export type StoredLogo = { data: Buffer; contentType: string; updatedAt: Date };

export class LogoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogoError";
  }
}

/**
 * Replaces a school's logo.
 *
 * `renditions` are square PNGs produced by the browser, which already has a
 * high-quality scaler in canvas — using it avoids a server-side image library,
 * and in particular a native one that the Electron build would have to unpack
 * alongside the Postgres binaries.
 *
 * Every rendition is verified to actually be a PNG of the size it claims, so a
 * malformed upload cannot end up inside the .ico where Windows would read it.
 */
export async function saveSchoolLogo(
  school_id: string,
  original: Buffer,
  renditions: { size: number; png: Buffer }[],
): Promise<void> {
  if (!isPng(original)) {
    throw new LogoError("The logo must be a PNG image.");
  }
  if (original.length > MAX_LOGO_BYTES) {
    throw new LogoError("The logo must be 2MB or smaller.");
  }

  const dimensions = pngDimensions(original);
  if (!dimensions || dimensions.width < 16 || dimensions.height < 16) {
    throw new LogoError("The logo must be at least 16×16 pixels.");
  }

  const usable = renditions.filter((rendition) => {
    if (!isPng(rendition.png)) return false;
    const size = pngDimensions(rendition.png);
    return size?.width === rendition.size && size?.height === rendition.size;
  });

  if (usable.length === 0) {
    throw new LogoError("The logo could not be resized. Try a different PNG.");
  }

  const ico = buildIco(usable);

  await transaction(async (client) => {
    await client.query(
      `
      INSERT INTO school_logos (school_id, original, ico, content_type, updated_at)
      VALUES ($1, $2, $3, 'image/png', CURRENT_TIMESTAMP)
      ON CONFLICT (school_id) DO UPDATE
        SET original = EXCLUDED.original,
            ico = EXCLUDED.ico,
            content_type = EXCLUDED.content_type,
            updated_at = CURRENT_TIMESTAMP
      `,
      [school_id, original, ico]
    );

    // Replaced wholesale: a new logo with fewer renditions must not leave the
    // previous logo's larger sizes behind to be served alongside it.
    await client.query(`DELETE FROM school_logo_renditions WHERE school_id = $1`, [school_id]);

    for (const rendition of usable) {
      await client.query(
        `INSERT INTO school_logo_renditions (school_id, size, png) VALUES ($1, $2, $3)`,
        [school_id, rendition.size, rendition.png]
      );
    }
  });
}

/** The logo at a given size, the .ico, or the original when size is omitted. */
export async function getSchoolLogo(
  school_id: string,
  options: { size?: number; ico?: boolean } = {},
): Promise<StoredLogo | null> {
  if (options.ico) {
    const result = await query(
      `SELECT ico AS data, updated_at FROM school_logos WHERE school_id = $1`,
      [school_id]
    );
    const row = result.rows[0];
    return row ? { data: row.data, contentType: "image/x-icon", updatedAt: row.updated_at } : null;
  }

  if (options.size) {
    const result = await query(
      `
      SELECT r.png AS data, l.updated_at
      FROM school_logo_renditions r
      JOIN school_logos l ON l.school_id = r.school_id
      WHERE r.school_id = $1 AND r.size = $2
      `,
      [school_id, options.size]
    );
    const row = result.rows[0];
    if (row) return { data: row.data, contentType: "image/png", updatedAt: row.updated_at };
    // Falls through to the original rather than 404ing: a size that was never
    // generated should still render something.
  }

  const result = await query(
    `SELECT original AS data, content_type, updated_at FROM school_logos WHERE school_id = $1`,
    [school_id]
  );
  const row = result.rows[0];
  return row ? { data: row.data, contentType: row.content_type, updatedAt: row.updated_at } : null;
}

export async function deleteSchoolLogo(school_id: string): Promise<boolean> {
  const result = await query(`DELETE FROM school_logos WHERE school_id = $1`, [school_id]);
  return (result.rowCount ?? 0) > 0;
}

/** Whether a school has a logo, without moving the image bytes. */
export async function schoolLogoStamp(school_id: string): Promise<string | null> {
  const result = await query(
    `SELECT updated_at FROM school_logos WHERE school_id = $1`,
    [school_id]
  );
  const row = result.rows[0];
  return row ? new Date(row.updated_at).getTime().toString(36) : null;
}
