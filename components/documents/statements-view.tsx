'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Printer, Stamp } from 'lucide-react';
import { useCurrentSchoolId } from '../../lib/client/current-school-id';
import { useSchoolName } from '../../lib/client/use-school-name';
import { formatCurrency } from '../../lib/currency';
import { documentsApi } from '../../services/documents';
import { balancesApi } from '../../services/payments';
import { schoolsApi } from '../../services/schools';
import { TEMPLATES, mergeTemplate, templateFor } from '../../lib/documents/templates';
import type { Learner } from '../../types/learner';
import { LearnerAutocomplete } from '../learners/learner-autocomplete';
import { SectionHeading } from '../shared/section-heading';
import { NoSchoolNotice } from '../shared/no-school-notice';
import { ErrorNotice } from '../shared/error-notice';
import { RichTextEditor } from './rich-text-editor';

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

export function StatementsView() {
  const { schoolId } = useCurrentSchoolId();
  const { name: schoolName } = useSchoolName();
  const queryClient = useQueryClient();

  const [documentType, setDocumentType] = useState<string>(TEMPLATES[0].type);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [title, setTitle] = useState(TEMPLATES[0].defaultTitle);
  const [bodyHtml, setBodyHtml] = useState('');
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('Head Teacher');
  const [issued, setIssued] = useState<{ document_id: number; reference: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const template = templateFor(documentType) ?? TEMPLATES[0];

  const school = useQuery({
    queryKey: ['school', schoolId],
    queryFn: () => schoolsApi.get(schoolId!),
    enabled: !!schoolId,
  });

  const history = useQuery({
    queryKey: ['documents', schoolId],
    queryFn: () => documentsApi.list(schoolId!),
    enabled: !!schoolId,
  });

  // Only fetched for templates that actually carry a statement, and only
  // once a learner is chosen. This is a preview of the same figures the
  // server will recompute and lock in when the document is issued.
  const statement = useQuery({
    queryKey: ['balances', schoolId, 'statement', learner?.learner_id],
    queryFn: () => balancesApi.list(schoolId!, { learner_id: learner!.learner_id }),
    enabled: !!schoolId && !!learner && template.includesStatement,
  });

  const statementTotals = useMemo(() => {
    const rows = statement.data ?? [];
    const charged = rows.reduce((sum, row) => sum + Number(row.charged ?? 0), 0);
    const paid = rows.reduce((sum, row) => sum + Number(row.paid ?? 0), 0);
    return { charged, paid, balance: charged - paid };
  }, [statement.data]);

  /** Loads the chosen template with the learner and school details merged in. */
  function loadTemplate(type: string, withLearner: Learner | null) {
    const next = templateFor(type) ?? TEMPLATES[0];
    const schoolRow = school.data?.[0];

    setBodyHtml(
      mergeTemplate(next.body, {
        learner_name: withLearner ? `${withLearner.first_name} ${withLearner.last_name}` : undefined,
        learner_id: withLearner?.learner_id,
        class_name: withLearner?.class_name,
        academic_year: withLearner?.curent_year,
        school_name: schoolName,
        school_address: schoolRow?.school_address ?? undefined,
        school_contact: schoolRow?.school_contact ?? undefined,
        today: todayLabel(),
      })
    );
    setTitle(next.defaultTitle);
    setIssued(null);
    setActionError(null);
  }

  const issue = useMutation({
    mutationFn: () =>
      documentsApi.issue(schoolId!, {
        learner_id: learner?.learner_id ?? null,
        document_type: documentType,
        title,
        body_html: bodyHtml,
        signatory_name: signatoryName,
        signatory_title: signatoryTitle,
      }),
    onSuccess: (created) => {
      setIssued({ document_id: created.document_id, reference: created.reference });
      queryClient.invalidateQueries({ queryKey: ['documents', schoolId] });
    },
  });

  async function runAction(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'That did not work.');
    }
  }

  const missingLearner = template.requiresLearner && !learner;
  const canIssue = !!schoolId && !missingLearner && !!signatoryName.trim() && !!bodyHtml.trim() && !issue.isPending;

  return (
    <>
      <SectionHeading
        eyebrow="School"
        title="Documents and letters"
        detail="Issue a letter or statement of account. Each carries a reference recorded here, so it can be verified later."
      />

      {!schoolId ? <NoSchoolNotice /> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Document type</label>
                <select
                  value={documentType}
                  onChange={(e) => {
                    setDocumentType(e.target.value);
                    loadTemplate(e.target.value, learner);
                  }}
                  className="field h-9 text-xs"
                  data-testid="select-document-type"
                >
                  {TEMPLATES.map((item) => (
                    <option key={item.type} value={item.type}>{item.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">{template.description}</p>
              </div>

              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">
                  Learner {template.requiresLearner ? '' : '(optional)'}
                </label>
                <LearnerAutocomplete
                  placeholder="Search by name…"
                  onSelect={(selected) => {
                    setLearner(selected);
                    loadTemplate(documentType, selected);
                  }}
                />
                {missingLearner && <p className="mt-1 text-[11px] text-destructive">This document needs a learner.</p>}
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="field h-9 text-xs" data-testid="input-document-title" />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[10px] font-semibold text-muted-foreground">Document body</label>
                <button
                  type="button"
                  onClick={() => loadTemplate(documentType, learner)}
                  className="text-[10px] text-muted-foreground underline hover:text-foreground"
                  data-testid="button-reset-template"
                >
                  Reset to template
                </button>
              </div>
              <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
            </div>

            {template.includesStatement && (
              <div className="mt-4 rounded-lg border border-border/70 bg-secondary/20 p-4">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-muted-foreground">
                  <FileText size={13} />
                  Statement of account — these figures are locked
                </div>
                {!learner ? (
                  <p className="text-xs text-muted-foreground">Choose a learner to see their account.</p>
                ) : statement.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="text-[10px] uppercase text-muted-foreground">
                        <tr><th className="py-1 font-semibold">Fee</th><th className="py-1 font-semibold">Period</th><th className="py-1 font-semibold">Charged</th><th className="py-1 font-semibold">Paid</th><th className="py-1 font-semibold">Balance</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {(statement.data ?? []).map((row, index) => (
                          <tr key={index}>
                            <td className="py-1">{row.income_name}</td>
                            <td className="py-1">{row.period_name}</td>
                            <td className="py-1">{formatCurrency(row.charged)}</td>
                            <td className="py-1">{formatCurrency(row.paid)}</td>
                            <td className="py-1 font-semibold">{formatCurrency(row.balance)}</td>
                          </tr>
                        ))}
                        {(statement.data?.length ?? 0) === 0 && (
                          <tr><td className="py-2 text-muted-foreground" colSpan={5}>No charges recorded for this learner.</td></tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border font-semibold">
                          <td className="py-1.5" colSpan={2}>TOTAL</td>
                          <td className="py-1.5">{formatCurrency(statementTotals.charged)}</td>
                          <td className="py-1.5">{formatCurrency(statementTotals.paid)}</td>
                          <td className="py-1.5">{formatCurrency(statementTotals.balance)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Recalculated from the live records when the document is issued, so it always matches the system.
                </p>
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Signed by</label>
                <input value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="e.g. J. Moyo" className="field h-9 text-xs" data-testid="input-signatory-name" />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Role</label>
                <input value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} className="field h-9 text-xs" data-testid="input-signatory-title" />
              </div>
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                The document prints a blank signature line above this name — sign it by hand. No signature image is ever stored.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canIssue}
                onClick={() => issue.mutate()}
                className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                data-testid="button-issue-document"
              >
                <Stamp size={15} />
                {issue.isPending ? 'Issuing…' : 'Issue document'}
              </button>

              {issued && (
                <>
                  <button type="button" onClick={() => runAction(() => documentsApi.download(schoolId, issued.document_id, issued.reference))} className="button-lift flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold" data-testid="button-download-document">
                    <Download size={15} />Download PDF
                  </button>
                  <button type="button" onClick={() => runAction(() => documentsApi.print(schoolId, issued.document_id))} className="button-lift flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold" data-testid="button-print-document">
                    <Printer size={15} />Print
                  </button>
                  <span className="text-[11px] font-semibold text-primary" data-testid="text-issued-reference">Issued as {issued.reference}</span>
                </>
              )}
            </div>

            <ErrorNotice error={issue.error} />
            {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-xs font-semibold text-foreground">Issued documents</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">Every document the school has sent out, newest first.</p>

            <div className="mt-3 space-y-2">
              {history.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
              {!history.isLoading && (history.data?.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">Nothing issued yet.</p>}

              {history.data?.map((row) => (
                <div key={row.document_id} className="rounded-lg border border-border/60 p-3" data-testid={`row-document-${row.document_id}`}>
                  <p className="text-[11px] font-semibold text-foreground">{row.title}</p>
                  <p className="text-[10px] text-muted-foreground">{row.learner_name ?? 'School-wide'}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{row.reference}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {new Date(row.issued_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {row.issued_by_label}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" onClick={() => runAction(() => documentsApi.download(schoolId, row.document_id, row.reference))} title="Download" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`button-download-${row.document_id}`}>
                      <Download size={14} />
                    </button>
                    <button type="button" onClick={() => runAction(() => documentsApi.print(schoolId, row.document_id))} title="Print" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`button-print-${row.document_id}`}>
                      <Printer size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <ErrorNotice error={history.error} />
          </div>
        </div>
      )}
    </>
  );
}
