import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST, DELETE } from "../app/api/schools/[school_id]/logo/route";
import { createSchool } from "../repositories/school/create/createSchool";
import { buildIco, isPng, pngDimensions } from "../lib/images/ico";
import { query } from "../lib/db";
import zlib from "node:zlib";

const SCHOOL = "TLG";

// Real PNGs, encoded here rather than pasted as a fixed base64 blob, so a
// rendition of any size can be produced and the size checks are exercised
// against genuine IHDR values.
function makePng(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const at = row + 1 + x * 4;
      raw[at] = 0xcb; raw[at + 1] = 0x63; raw[at + 2] = 0x3a; raw[at + 3] = 0xff;
    }
  }

  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typeAndBody = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndBody) >>> 0);
    return Buffer.concat([length, typeAndBody, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc;
}

const LOGO_PNG = makePng(64);
const RENDITION_16 = makePng(16);
const RENDITION_32 = makePng(32);

function params(school_id: string) {
  return { params: Promise.resolve({ school_id }) };
}

beforeAll(async () => {
  await createSchool([{ school_id: SCHOOL, school_name: "Logo Test School", school_type: "primary", school_address: "n/a", school_contact: "n/a", school_email: "logo@test.local" }]);
});

afterAll(async () => {
  await query("DELETE FROM school_logos WHERE school_id = $1", [SCHOOL]);
  await query("DELETE FROM schools WHERE school_id = $1", [SCHOOL]);
});

describe("ICO encoding", () => {
  it("recognises a PNG and reads its dimensions from the IHDR", () => {
    expect(isPng(LOGO_PNG)).toBe(true);
    expect(pngDimensions(LOGO_PNG)).toEqual({ width: 64, height: 64 });
    expect(isPng(Buffer.from("not an image"))).toBe(false);
  });

  it("writes a directory Windows can read, with one entry per size", () => {
    const ico = buildIco([
      { size: 16, png: RENDITION_16 },
      { size: 32, png: RENDITION_32 },
      { size: 256, png: LOGO_PNG },
    ]);

    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(3); // three images

    // 256 is stored as 0 — the width field is a single byte.
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(6 + 16)).toBe(32);
    expect(ico.readUInt8(6 + 32)).toBe(0);

    // Each entry's offset and length must actually address its PNG.
    for (let i = 0; i < 3; i++) {
      const at = 6 + i * 16;
      const length = ico.readUInt32LE(at + 8);
      const offset = ico.readUInt32LE(at + 12);
      const expected = [RENDITION_16, RENDITION_32, LOGO_PNG][i];
      expect(length).toBe(expected.length);
      expect(ico.subarray(offset, offset + length).equals(expected)).toBe(true);
    }
  });

  it("refuses to build an icon out of data that is not a PNG", () => {
    expect(() => buildIco([{ size: 16, png: Buffer.from("nope") }])).toThrow();
  });
});

describe("school logo endpoint", () => {
  it("stores an uploaded logo and serves it back, as PNG and as an icon", async () => {
    const upload = await POST(
      new Request("http://localhost/api/schools/TLG/logo", {
        method: "POST",
        body: JSON.stringify({
          original: `data:image/png;base64,${LOGO_PNG.toString("base64")}`,
          renditions: [
            { size: 16, png: RENDITION_16.toString("base64") },
            { size: 32, png: RENDITION_32.toString("base64") },
          ],
        }),
      }),
      params(SCHOOL),
    );
    expect(upload.status).toBe(201);

    const png = await GET(new Request("http://localhost/api/schools/TLG/logo"), params(SCHOOL));
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await png.arrayBuffer()).equals(LOGO_PNG)).toBe(true);

    const ico = await GET(new Request("http://localhost/api/schools/TLG/logo?format=ico"), params(SCHOOL));
    expect(ico.status).toBe(200);
    expect(ico.headers.get("Content-Type")).toBe("image/x-icon");
    const icoBytes = Buffer.from(await ico.arrayBuffer());
    expect(icoBytes.readUInt16LE(2)).toBe(1);
  });

  it("reports whether a logo exists without shipping the image", async () => {
    const meta = await GET(new Request("http://localhost/api/schools/TLG/logo?meta=1"), params(SCHOOL));
    const body = await meta.json();
    expect(body.hasLogo).toBe(true);
    expect(typeof body.stamp).toBe("string");
  });

  it("serves 304 when the caller already has the current logo", async () => {
    const first = await GET(new Request("http://localhost/api/schools/TLG/logo"), params(SCHOOL));
    const etag = first.headers.get("ETag")!;
    expect(etag).toBeTruthy();

    const second = await GET(
      new Request("http://localhost/api/schools/TLG/logo", { headers: { "if-none-match": etag } }),
      params(SCHOOL),
    );
    expect(second.status).toBe(304);
  });

  it("replaces the renditions rather than leaving the previous logo's behind", async () => {
    await POST(
      new Request("http://localhost/api/schools/TLG/logo", {
        method: "POST",
        body: JSON.stringify({
          original: LOGO_PNG.toString("base64"),
          renditions: [{ size: 16, png: RENDITION_16.toString("base64") }],
        }),
      }),
      params(SCHOOL),
    );

    const rows = await query("SELECT size FROM school_logo_renditions WHERE school_id = $1", [SCHOOL]);
    expect(rows.rowCount).toBe(1);
  });

  it("rejects an upload that is not a PNG", async () => {
    const response = await POST(
      new Request("http://localhost/api/schools/TLG/logo", {
        method: "POST",
        body: JSON.stringify({
          original: Buffer.from("this is not an image").toString("base64"),
          renditions: [],
        }),
      }),
      params(SCHOOL),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/PNG/i);
  });

  it("rejects a size that is not one of the icon sizes", async () => {
    const response = await GET(new Request("http://localhost/api/schools/TLG/logo?size=999"), params(SCHOOL));
    expect(response.status).toBe(400);
  });

  it("removes the logo, and says so when there is nothing to remove", async () => {
    const removed = await DELETE(new Request("http://localhost/api/schools/TLG/logo", { method: "DELETE" }), params(SCHOOL));
    expect(removed.status).toBe(200);

    const again = await DELETE(new Request("http://localhost/api/schools/TLG/logo", { method: "DELETE" }), params(SCHOOL));
    expect(again.status).toBe(404);

    const meta = await GET(new Request("http://localhost/api/schools/TLG/logo?meta=1"), params(SCHOOL));
    expect((await meta.json()).hasLogo).toBe(false);

    // The renditions must go with it rather than being orphaned.
    const rows = await query("SELECT size FROM school_logo_renditions WHERE school_id = $1", [SCHOOL]);
    expect(rows.rowCount).toBe(0);
  });
});
