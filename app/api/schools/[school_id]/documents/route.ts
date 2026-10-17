import { NextResponse } from "next/server";
import { requireAuth, resolveSchoolScope } from "../../../../../lib/auth/guard";
import { actorLabel } from "../../../../../lib/auth/session";
import { createDocument, DocumentInputError } from "../../../../../repositories/document/createDocument";
import { listDocuments } from "../../../../../repositories/document/readDocuments";
import { buildStatementFor } from "../../../../../lib/documents/statement";
import { buildInvoice, InvoiceInputError, parseInvoiceLines } from "../../../../../lib/documents/invoice";
import { templateFor } from "../../../../../lib/documents/templates";

export const runtime = "nodejs";

type Params = { params: Promise<{ school_id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "document.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const { searchParams } = new URL(request.url);
    const learner_id = searchParams.get("learner_id");
    const document_type = searchParams.get("document_type");

    return NextResponse.json(
      await listDocuments(scope.school_id, {
        learner_id: learner_id && learner_id !== "null" ? learner_id : null,
        document_type: document_type && document_type !== "null" ? document_type : null,
      })
    );
  } catch (error) {
    console.error("Get documents error:", error);
    return NextResponse.json({ error: "Failed to retrieve documents" }, { status: 500 });
  }
}

/**
 * Issues a document: assigns its reference, stores exactly what went out,
 * and records it in the history.
 *
 * The statement figures are recomputed here from live charges and payments
 * and whatever the client sent is ignored. That is the point of the locked
 * block — a statement handed to a parent has to be the school's numbers, not
 * numbers the page happened to be holding.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireAuth(request, "document.manage");
    if (!auth.ok) return auth.response;

    const { school_id } = await params;
    const scope = resolveSchoolScope(auth.actor, school_id);
    if (!scope.ok) return scope.response;

    const body = await request.json().catch(() => null);

    const document_type = typeof body?.document_type === "string" ? body.document_type : "";
    const template = templateFor(document_type);
    if (!template) {
      return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
    }

    const learner_id = typeof body?.learner_id === "string" && body.learner_id.length > 0 ? body.learner_id : null;
    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : template.defaultTitle;
    const body_html = typeof body?.body_html === "string" ? body.body_html : "";
    const signatory_name = typeof body?.signatory_name === "string" ? body.signatory_name.trim() : "";
    const signatory_title = typeof body?.signatory_title === "string" ? body.signatory_title.trim() : "";

    if (!signatory_name || !signatory_title) {
      return NextResponse.json({ error: "Who is signing the document, and in what role?" }, { status: 400 });
    }

    const statement = template.includesStatement && learner_id ? await buildStatementFor(scope.school_id, learner_id) : null;

    // The amounts are the user's (a fee's default limit can be changed for
    // one invoice), but the fee and period names and the total are worked
    // out here from the school's own records.
    const invoice = template.includesInvoice
      ? await buildInvoice(scope.school_id, parseInvoiceLines(body?.invoice_lines))
      : null;

    const created = await createDocument({
      school_id: scope.school_id,
      learner_id,
      document_type,
      title,
      body_html,
      statement,
      invoice,
      signatory_name,
      signatory_title,
      issued_by_employee_id: auth.actor.employee_id,
      issued_by_label: actorLabel(auth.actor),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentInputError || error instanceof InvoiceInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Document creation failed:", error);
    return NextResponse.json({ error: "Could not issue the document" }, { status: 500 });
  }
}
