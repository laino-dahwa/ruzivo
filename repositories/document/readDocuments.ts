import { query } from "../../lib/db";

export type DocumentSummary = {
  document_id: number;
  reference: string;
  document_type: string;
  title: string;
  learner_id: string | null;
  learner_name: string | null;
  signatory_name: string;
  issued_by_label: string;
  issued_at: string;
};

/** The issue history — what the school has sent out, newest first. */
export async function listDocuments(school_id: string, filters: { learner_id?: string | null; document_type?: string | null } = {}) {
  const result = await query(
    `
    SELECT
      d.document_id::int AS document_id,
      d.reference,
      d.document_type,
      d.title,
      d.learner_id,
      CASE WHEN l.learner_id IS NULL THEN NULL ELSE l.first_name || ' ' || l.last_name END AS learner_name,
      d.signatory_name,
      d.issued_by_label,
      d.issued_at
    FROM documents d
    LEFT JOIN learners l ON l.learner_id = d.learner_id
    WHERE d.school_id = $1
      AND ($2::text IS NULL OR d.learner_id = $2::text)
      AND ($3::text IS NULL OR d.document_type = $3::text)
    ORDER BY d.issued_at DESC, d.document_id DESC
    LIMIT 200
    `,
    [school_id, filters.learner_id ?? null, filters.document_type ?? null]
  );

  return result.rows as DocumentSummary[];
}

/**
 * One issued document, with the body exactly as it went out.
 *
 * Scoped by school_id as well as id: a document reference from one school
 * must not be readable by another.
 */
export async function getDocument(school_id: string, document_id: number) {
  const result = await query(
    `
    SELECT
      d.document_id::int AS document_id,
      d.school_id,
      d.learner_id,
      d.document_type,
      d.title,
      d.reference,
      d.body_html,
      d.statement_data,
      d.invoice_data,
      d.signatory_name,
      d.signatory_title,
      d.issued_by_label,
      d.issued_at,
      CASE WHEN l.learner_id IS NULL THEN NULL ELSE l.first_name || ' ' || l.last_name END AS learner_name,
      ca.class_name
    FROM documents d
    LEFT JOIN learners l ON l.learner_id = d.learner_id
    LEFT JOIN LATERAL (
      SELECT c.class_name
      FROM enrolments e
      JOIN class_categories c ON c.class_category_id = e.class_category_id
      WHERE e.learner_id = d.learner_id
      ORDER BY e.enrolment_id DESC
      LIMIT 1
    ) ca ON TRUE
    WHERE d.school_id = $1 AND d.document_id = $2
    `,
    [school_id, document_id]
  );

  return result.rows[0] ?? null;
}
