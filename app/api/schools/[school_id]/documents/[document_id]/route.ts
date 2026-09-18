import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../../lib/auth/guard";
import { getDocument } from "../../../../../../repositories/document/readDocuments";
import { getschool } from "../../../../../../repositories/school/read/getSchool";
import { getSchoolLogo } from "../../../../../../repositories/school/logo/schoolLogo";
import { renderDocumentPdf } from "../../../../../../lib/documents/renderDocumentPdf";
import { formatDateLabel } from "../../../../../../lib/reportRequest";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string; document_id: string }> };

/**
 * Re-renders an issued document from what was stored.
 *
 * Always regenerated rather than served from a saved file, but always from
 * the stored body and the stored statement snapshot — so a reprint months
 * later is identical to the copy the parent holds, even though balances have
 * moved on since.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "document.manage");
    if (!auth.ok) return auth.response;

    const { school_id, document_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const id = Number(document_id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Unknown document." }, { status: 400 });
    }

    const document = await getDocument(scope.school_id, id);
    if (!document) {
      return NextResponse.json({ error: "Unknown document." }, { status: 404 });
    }

    const [school] = await getschool(scope.school_id);
    const logo = await getSchoolLogo(scope.school_id, { size: 256 });

    const issuedAt = new Date(document.issued_at);

    const pdf = await renderDocumentPdf({
      schoolName: school?.school_name ?? scope.school_id,
      schoolAddress: school?.school_address ?? null,
      schoolContact: school?.school_contact ?? null,
      logo: logo?.data ?? null,
      title: document.title,
      reference: document.reference,
      issuedAt,
      issuedAtLabel: formatDateLabel(issuedAt.toISOString().slice(0, 10)),
      issuedByLabel: document.issued_by_label,
      learnerLine: document.learner_name
        ? `${document.learner_name}${document.class_name ? ` — ${document.class_name}` : ""} (${document.learner_id})`
        : null,
      bodyHtml: document.body_html,
      statement: document.statement_data ?? null,
      signatoryName: document.signatory_name,
      signatoryTitle: document.signatory_title,
    });

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // inline, not attachment: this URL is opened for printing as well as
        // saved, and the client decides which by how it fetches it.
        "Content-Disposition": `inline; filename="${document.reference}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Document render failed:", error);
    return NextResponse.json({ error: "Could not produce the document" }, { status: 500 });
  }
}
