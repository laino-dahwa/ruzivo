import { transaction } from "../../lib/db";
import { formatReference, templateFor } from "../../lib/documents/templates";
import { logAuditWithin } from "../audit/writeAuditLog";
import type { InvoiceData, StatementData } from "../../lib/documents/renderDocumentPdf";

export class DocumentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentInputError";
  }
}

export type CreateDocumentInput = {
  school_id: string;
  learner_id: string | null;
  document_type: string;
  title: string;
  body_html: string;
  statement: StatementData | null;
  /** Required for an invoice, null for everything else. */
  invoice?: InvoiceData | null;
  signatory_name: string;
  signatory_title: string;
  issued_by_employee_id: number | null;
  issued_by_label: string;
};

/**
 * Records an issued document and assigns it its printed reference.
 *
 * The reference comes from a dedicated sequence taken inside the same
 * transaction as the insert, so the number printed on the PDF is the number
 * stored against the row — which is the whole basis for being able to verify
 * a document later.
 */
export async function createDocument(input: CreateDocumentInput) {
  const template = templateFor(input.document_type);
  if (!template) {
    throw new DocumentInputError("Unknown document type.");
  }

  if (template.requiresLearner && !input.learner_id) {
    throw new DocumentInputError(`A ${template.label.toLowerCase()} must be issued for a learner.`);
  }

  if (template.includesInvoice && !input.invoice?.lines.length) {
    throw new DocumentInputError("Add at least one income stream to the invoice.");
  }

  if (!input.body_html.trim()) {
    throw new DocumentInputError("The document is empty.");
  }

  return transaction(async (client) => {
    const sequence = await client.query(`SELECT nextval('document_reference_seq') AS value`);
    const reference = formatReference(input.school_id, template.code, Number(sequence.rows[0].value));

    const result = await client.query(
      `
      INSERT INTO documents (
        school_id, learner_id, document_type, title, reference, body_html,
        statement_data, signatory_name, signatory_title,
        issued_by_employee_id, issued_by_label, invoice_data
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb)
      RETURNING document_id::int AS document_id, reference, issued_at
      `,
      [
        input.school_id,
        input.learner_id,
        input.document_type,
        input.title,
        reference,
        input.body_html,
        input.statement === null ? null : JSON.stringify(input.statement),
        input.signatory_name,
        input.signatory_title,
        input.issued_by_employee_id,
        input.issued_by_label,
        input.invoice ? JSON.stringify(input.invoice) : null,
      ]
    );

    const created = result.rows[0];

    await logAuditWithin(client, {
      employee_id: input.issued_by_employee_id,
      actor_label: input.issued_by_label,
      school_id: input.school_id,
      action: "document.issue",
      entity_type: "document",
      entity_id: String(created.document_id),
      summary: `Issued ${template.label.toLowerCase()} ${created.reference}${input.learner_id ? ` for learner ${input.learner_id}` : ""}`,
    });

    return {
      document_id: created.document_id,
      reference: created.reference,
      issued_at: created.issued_at,
    };
  });
}
