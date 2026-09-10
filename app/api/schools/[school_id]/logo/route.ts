import { NextResponse } from "next/server";
import {
    LOGO_SIZES,
    LogoError,
    MAX_LOGO_BYTES,
    deleteSchoolLogo,
    getSchoolLogo,
    saveSchoolLogo,
    schoolLogoStamp,
} from "../../../../../repositories/school/logo/schoolLogo";

export const runtime = "nodejs";

type Params = {
    params: Promise<{ school_id: string }>;
};

/**
 * Serves the logo: the original by default, one rendition with `?size=`, or the
 * Windows icon with `?format=ico`.
 *
 * The response is cached against the logo's updated_at, so a replaced logo is
 * picked up immediately while an unchanged one is not refetched on every page —
 * this URL sits in a <link rel="icon"> and in the sidebar.
 */
export async function GET(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const { searchParams } = new URL(request.url);

        // A cheap existence check for the shell and the favicon, which need to
        // know whether to show a logo — and its stamp for cache-busting —
        // without pulling the image itself on every page.
        if (searchParams.get("meta") === "1") {
            const stamp = await schoolLogoStamp(school_id);
            return NextResponse.json({ hasLogo: stamp !== null, stamp });
        }

        const wantsIco = searchParams.get("format") === "ico";
        const sizeRaw = searchParams.get("size");
        const size = sizeRaw ? Number(sizeRaw) : undefined;

        if (sizeRaw && (!Number.isInteger(size) || !LOGO_SIZES.includes(size as (typeof LOGO_SIZES)[number]))) {
            return NextResponse.json(
                { error: `size must be one of ${LOGO_SIZES.join(", ")}` },
                { status: 400 }
            );
        }

        const logo = await getSchoolLogo(school_id, { size, ico: wantsIco });
        if (!logo) {
            return NextResponse.json({ error: "This school has no logo." }, { status: 404 });
        }

        const etag = `"${new Date(logo.updatedAt).getTime().toString(36)}-${size ?? (wantsIco ? "ico" : "full")}"`;
        if (request.headers.get("if-none-match") === etag) {
            return new NextResponse(null, { status: 304, headers: { ETag: etag } });
        }

        return new NextResponse(new Uint8Array(logo.data), {
            status: 200,
            headers: {
                "Content-Type": logo.contentType,
                "Content-Length": String(logo.data.length),
                ETag: etag,
                "Cache-Control": "private, max-age=0, must-revalidate",
            },
        });
    } catch (error) {
        console.error("Logo Read Failed :", error);
        return NextResponse.json({ error: "Failed to load the logo" }, { status: 500 });
    }
}

type UploadBody = {
    original?: string;
    renditions?: { size?: number; png?: string }[];
};

/**
 * Stores a new logo. The body carries base64 PNGs: the original, plus one
 * square rendition per icon size, scaled by the browser's canvas.
 */
export async function POST(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const body = (await request.json()) as UploadBody;

        if (typeof body.original !== "string" || !Array.isArray(body.renditions)) {
            return NextResponse.json(
                { error: "Expected an original image and its renditions." },
                { status: 400 }
            );
        }

        const original = decodeBase64Png(body.original);
        if (!original) {
            return NextResponse.json({ error: "The logo could not be read." }, { status: 400 });
        }
        // Checked before decoding the renditions so an oversized upload is
        // rejected without first expanding all six of them in memory.
        if (original.length > MAX_LOGO_BYTES) {
            return NextResponse.json({ error: "The logo must be 2MB or smaller." }, { status: 400 });
        }

        const renditions: { size: number; png: Buffer }[] = [];
        for (const rendition of body.renditions) {
            const png = typeof rendition?.png === "string" ? decodeBase64Png(rendition.png) : null;
            if (png && typeof rendition.size === "number") {
                renditions.push({ size: rendition.size, png });
            }
        }

        await saveSchoolLogo(school_id, original, renditions);
        return NextResponse.json({ ok: true, stamp: await schoolLogoStamp(school_id) }, { status: 201 });
    } catch (error) {
        if (error instanceof LogoError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        console.error("Logo Upload Failed :", error);
        return NextResponse.json({ error: "Failed to save the logo" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: Params) {
    try {
        const { school_id } = await params;
        const removed = await deleteSchoolLogo(school_id);
        if (!removed) {
            return NextResponse.json({ error: "This school has no logo." }, { status: 404 });
        }
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Logo Delete Failed :", error);
        return NextResponse.json({ error: "Failed to remove the logo" }, { status: 500 });
    }
}

/** Accepts a bare base64 string or a `data:image/png;base64,…` URL. */
function decodeBase64Png(value: string): Buffer | null {
    const base64 = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
    try {
        const buffer = Buffer.from(base64, "base64");
        return buffer.length > 0 ? buffer : null;
    } catch {
        return null;
    }
}
