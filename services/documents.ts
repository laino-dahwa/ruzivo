import { request } from './http';
import { downloadFileFrom } from './pdf';
import { errorMessageFor } from './http';

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

export type IssueDocumentInput = {
  learner_id: string | null;
  document_type: string;
  title: string;
  body_html: string;
  signatory_name: string;
  signatory_title: string;
};

function documentUrl(schoolId: string, documentId: number) {
  return `/api/schools/${encodeURIComponent(schoolId)}/documents/${documentId}`;
}

export const documentsApi = {
  list: (schoolId: string, filters: { learner_id?: string | null; document_type?: string | null } = {}) => {
    const search = new URLSearchParams();
    if (filters.learner_id) search.set('learner_id', filters.learner_id);
    if (filters.document_type) search.set('document_type', filters.document_type);
    const suffix = search.toString();
    return request<DocumentSummary[]>(`/api/schools/${encodeURIComponent(schoolId)}/documents${suffix ? `?${suffix}` : ''}`);
  },

  issue: (schoolId: string, input: IssueDocumentInput) =>
    request<{ document_id: number; reference: string; issued_at: string }>(
      `/api/schools/${encodeURIComponent(schoolId)}/documents`,
      { method: 'POST', body: JSON.stringify(input) }
    ),

  download: (schoolId: string, documentId: number, reference: string) =>
    downloadFileFrom(documentUrl(schoolId, documentId), `${reference}.pdf`),

  /**
   * Prints the issued PDF itself rather than a separate HTML rendering of
   * the same content. A second renderer for printing would eventually drift
   * from the PDF, and for an official document "the printed copy differs
   * from the filed copy" is the one failure that must not happen.
   *
   * The PDF is fetched, handed to a hidden frame as a blob, and printed from
   * there — which keeps it inside the app rather than bouncing the user
   * through a browser tab.
   */
  print: async (schoolId: string, documentId: number) => {
    const response = await fetch(documentUrl(schoolId, documentId));
    if (!response.ok) throw new Error(await errorMessageFor(response));

    const objectUrl = URL.createObjectURL(await response.blob());
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.src = objectUrl;

    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        // A viewer that refuses to be driven still leaves the user the
        // Download button, so this must not surface as a crash.
      }
    };

    document.body.appendChild(frame);

    // Left attached long enough for the print dialog to take its copy;
    // removing it immediately cancels the job in Chromium.
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(objectUrl);
    }, 60_000);
  },
};
