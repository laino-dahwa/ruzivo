/**
 * The built-in document types and their starting wording.
 *
 * Each template is opened pre-filled — placeholders replaced with the real
 * learner and school details — and is then freely editable before it is
 * issued. Nothing here is the final word on what goes out; it exists so
 * nobody retypes the same transfer letter for every learner.
 *
 * The markup is deliberately limited to what lib/documents/renderDocumentPdf
 * can draw: headings, paragraphs, bold/italic/underline, lists and
 * alignment. Anything richer would look right on screen and wrong on paper.
 */

export const DOCUMENT_TYPES = ["transfer_letter", "acknowledgement_letter", "newsletter", "fee_statement", "invoice", "general_letter"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type TemplateDefinition = {
  type: DocumentType;
  label: string;
  /** Two letters, used in the printed reference — "SSV-TL-000147". */
  code: string;
  description: string;
  /** Whether a learner must be chosen before this document makes sense. */
  requiresLearner: boolean;
  /** Whether the locked statement-of-account block is inserted. */
  includesStatement: boolean;
  /** Whether the invoice items table is inserted (lib/documents/invoice.ts). */
  includesInvoice?: boolean;
  /** How the printed reference is labelled — "Ref" unless set. */
  referenceLabel?: string;
  defaultTitle: string;
  body: string;
};

export type MergeFields = {
  learner_name: string;
  learner_id: string;
  class_name: string;
  academic_year: string;
  school_name: string;
  school_address: string;
  school_contact: string;
  today: string;
};

/**
 * `{{placeholder}}` names available to templates. Kept as a plain list so the
 * editor can show the user which ones exist.
 */
export const MERGE_FIELD_LABELS: Record<keyof MergeFields, string> = {
  learner_name: "Learner name",
  learner_id: "Learner ID",
  class_name: "Class",
  academic_year: "Academic year",
  school_name: "School name",
  school_address: "School address",
  school_contact: "School contact",
  today: "Today's date",
};

export const TEMPLATES: TemplateDefinition[] = [
  {
    type: "transfer_letter",
    label: "Transfer letter",
    code: "TL",
    description: "Confirms a learner is leaving and that their record is in order.",
    requiresLearner: true,
    includesStatement: false,
    defaultTitle: "Transfer Letter",
    body: `<p>To whom it may concern,</p>
<p>This is to confirm that <strong>{{learner_name}}</strong> (Learner ID {{learner_id}}) has been a learner at {{school_name}}, most recently in {{class_name}} during the {{academic_year}} academic year.</p>
<p>The learner is leaving our school in good standing, and we have no objection to their enrolment elsewhere. Their conduct and attendance were satisfactory throughout their time with us.</p>
<p>We wish {{learner_name}} every success in their continued education. Please contact us on {{school_contact}} should you require any further information.</p>`,
  },
  {
    type: "acknowledgement_letter",
    label: "Acknowledgement letter",
    code: "AL",
    description: "Confirms a learner is currently enrolled here. For embassies, banks, sponsors, medical aid — anyone who needs proof.",
    requiresLearner: true,
    includesStatement: false,
    defaultTitle: "Acknowledgement of Enrolment",
    // Addressed to nobody in particular on purpose: the same letter is asked
    // for by embassies, banks, sponsors and medical aid schemes, each for
    // their own reasons, so it confirms the fact and leaves the use to the
    // reader. Name a specific recipient by editing the first line.
    body: `<p><strong>TO WHOM IT MAY CONCERN</strong></p>
<p>This is to confirm that <strong>{{learner_name}}</strong>, Learner ID {{learner_id}}, is a currently enrolled learner at {{school_name}}.</p>
<p>The learner is in {{class_name}} for the {{academic_year}} academic year and is in regular attendance as at {{today}}.</p>
<p>This letter is issued at the request of the learner's parent or guardian, and may be relied upon for any lawful purpose requiring confirmation of the learner's enrolment at this school.</p>
<p>Should you wish to verify this letter or require any further information, please contact the school office on {{school_contact}}, quoting the reference number shown above.</p>`,
  },
  {
    type: "fee_statement",
    label: "Statement of account",
    code: "ST",
    description: "A learner's charges, payments and outstanding balance, taken live from the records.",
    requiresLearner: true,
    includesStatement: true,
    defaultTitle: "Statement of Account",
    body: `<p>Dear Parent or Guardian,</p>
<p>Please find below the statement of account for <strong>{{learner_name}}</strong> of {{class_name}} (Learner ID {{learner_id}}) as at {{today}}.</p>`,
  },
  {
    type: "invoice",
    label: "Invoice",
    code: "IN",
    description: "Bill a learner's parent for the income streams you choose. Each starts at its default limit, which you can change for this invoice.",
    requiresLearner: true,
    includesStatement: false,
    includesInvoice: true,
    referenceLabel: "Invoice No",
    defaultTitle: "Invoice",
    body: `<p>Dear Parent or Guardian,</p>
<p>Please find below the fees due for <strong>{{learner_name}}</strong> of {{class_name}} (Learner ID {{learner_id}}) for the {{academic_year}} academic year, as at {{today}}.</p>
<p>Kindly settle this invoice at the school office, quoting the invoice number above. Please contact us on {{school_contact}} with any questions.</p>`,
  },
  {
    type: "newsletter",
    label: "Newsletter",
    code: "NL",
    description: "A general notice to parents. Does not need a learner.",
    requiresLearner: false,
    includesStatement: false,
    defaultTitle: "School Newsletter",
    body: `<h2>A message from the school</h2>
<p>Dear Parents and Guardians,</p>
<p>Write your newsletter here. You can use headings, <strong>bold</strong> and <em>italic</em> text, and lists:</p>
<ul>
<li>Upcoming events and important dates</li>
<li>Reminders about fees and deadlines</li>
<li>News and achievements worth sharing</li>
</ul>
<p>Thank you for your continued support.</p>`,
  },
  {
    type: "general_letter",
    label: "General letter",
    code: "GN",
    description: "A blank letter on school letterhead, for anything the other templates do not cover.",
    requiresLearner: false,
    includesStatement: false,
    defaultTitle: "Letter",
    body: `<p>Dear Sir or Madam,</p>
<p>Write your letter here.</p>`,
  },
];

export function templateFor(type: string): TemplateDefinition | null {
  return TEMPLATES.find((template) => template.type === type) ?? null;
}

/** Replaces every {{placeholder}} with its value, leaving unknown ones visible so they are noticed. */
export function mergeTemplate(body: string, fields: Partial<MergeFields>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = fields[name as keyof MergeFields];
    return value === undefined || value === null || value === "" ? whole : String(value);
  });
}

/** "SSV-TL-000147" */
export function formatReference(schoolId: string, code: string, sequence: number): string {
  return `${schoolId.trim().toUpperCase()}-${code}-${String(sequence).padStart(6, "0")}`;
}
