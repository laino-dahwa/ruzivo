import { useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '../app/components/error-boundary';
import { Toaster } from '../app/components/ui/toaster';
import { TooltipProvider } from '../app/components/ui/tooltip';
import { useToast } from '../app/components/hooks/use-toast';
import {
  academicYearsApi,
  balancesApi,
  classCategoriesApi,
  expenseCategoriesApi,
  expensesApi,
  gendersApi,
  incomeCategoriesApi,
  learnersApi,
  paymentMethodsApi,
  paymentPeriodsApi,
  paymentsApi,
  reportsApi,
  schoolsApi,
  type AcademicYear,
  type ClassCategory,
  type CreateChargesWithPaymentsInput,
  type CreateLearnerInput,
  type ExpenseCategory,
  type Gender,
  type IncomeCategory,
  type Learner,
  type Payment,
  type PaymentMethod,
  type PaymentPeriod,
  type ReportDate,
  type ReportType,
  type School,
} from '../app/components/lib/api';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Download,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Menu,
  Plus,
  Receipt,
  Search,
  Trash2,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const SCHOOL_STORAGE_KEY = 'ruzivo:current-school-id';

const money = (value: number | string) => {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number.isFinite(numeric) ? numeric : 0);
};

const schoolIdListeners = new Set<() => void>();

function subscribeToSchoolId(callback: () => void) {
  schoolIdListeners.add(callback);
  return () => schoolIdListeners.delete(callback);
}

function getSchoolIdSnapshot() {
  return window.localStorage.getItem(SCHOOL_STORAGE_KEY);
}

// Server never has a stored school, so this must match the client's first render.
function getSchoolIdServerSnapshot() {
  return null;
}

function setStoredSchoolId(value: string | null) {
  if (value) window.localStorage.setItem(SCHOOL_STORAGE_KEY, value);
  else window.localStorage.removeItem(SCHOOL_STORAGE_KEY);
  schoolIdListeners.forEach((listener) => listener());
}

function useCurrentSchoolId() {
  const schoolId = useSyncExternalStore(subscribeToSchoolId, getSchoolIdSnapshot, getSchoolIdServerSnapshot);
  return { schoolId, setSchoolId: setStoredSchoolId };
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const { schoolId } = useCurrentSchoolId();
  const nav = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/school', label: 'School setup', icon: Landmark },
    { href: '/learners', label: 'Learners', icon: Users },
    { href: '/payments', label: 'Payments', icon: CircleDollarSign },
    { href: '/expenses', label: 'Expenses', icon: Receipt },
    { href: '/reports', label: 'Reports', icon: FileBarChart },
  ];
  return (
    <div className="grain min-h-[100dvh] bg-background md:flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-[254px] bg-sidebar px-5 py-6 text-sidebar-foreground transition-transform duration-300 md:relative md:translate-x-0 ${mobileNav ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-2">
            <Link href="/" data-testid="link-brand" className="flex items-center gap-3 text-sidebar-foreground">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><WalletCards size={18} strokeWidth={2.3} /></span>
              <span><span className="block text-[15px] font-semibold tracking-[-.02em]">Ruzivo</span><span className="block text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/55">Finance office</span></span>
            </Link>
            <button type="button" onClick={() => setMobileNav(false)} className="text-sidebar-foreground/60 md:hidden" aria-label="Close navigation" data-testid="button-close-navigation"><X size={19} /></button>
          </div>
          <div className="mt-12 px-2 text-[10px] font-semibold uppercase tracking-[.2em] text-sidebar-foreground/45">Workspace</div>
          <nav className="mt-3 space-y-1" aria-label="Primary navigation">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} onClick={() => setMobileNav(false)} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} className={`nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium ${location === href || (href !== '/' && location.startsWith(href)) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground'}`}>
                <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-auto rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-4">
            <div className="flex items-center gap-2 text-sidebar-foreground/60"><CalendarDays size={14} /><span className="text-[11px]">Active school</span></div>
            <p className="mt-2 truncate text-sm font-medium">{schoolId ?? 'None selected'}</p>
            <Link href="/school" className="mt-2 block text-[10px] text-sidebar-foreground/60 hover:text-sidebar-foreground">Manage in School setup →</Link>
          </div>
        </div>
      </aside>
      {mobileNav && <button type="button" aria-label="Close menu overlay" onClick={() => setMobileNav(false)} className="fixed inset-0 z-30 bg-black/20 md:hidden" data-testid="button-menu-overlay" />}
      <main className="min-w-0 flex-1">
        <header className="flex h-[76px] items-center justify-between border-b border-border/70 px-5 md:px-10">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-muted-foreground md:hidden" aria-label="Open navigation" data-testid="button-open-navigation"><Menu size={20} /></button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span>Ruzivo</span><span className="text-border">/</span><span className="text-foreground">Live data from your API</span></div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground" data-testid="avatar-user">RZ</div>
          </div>
        </header>
        <div className="mx-auto max-w-[1380px] px-5 py-8 md:px-10 md:py-10">{children}</div>
      </main>
    </div>
  );
}

function SectionHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary">{eyebrow}</p>
        <h1 className="serif text-3xl font-semibold tracking-[-.03em] text-foreground md:text-[38px]">{title}</h1>
        {detail && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

function MetricCard({ label, value, note, icon: Icon }: { label: string; value: string; note: string; icon: typeof Users }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5" data-testid={`card-metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon size={16} /></span>
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-[-.045em]">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

function NoSchoolNotice() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <p className="text-sm font-semibold">No school selected yet</p>
      <p className="mt-1 text-xs text-muted-foreground">Create or select a school in School setup to load live data from your API.</p>
      <Link href="/school" className="button-lift mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"><Plus size={15} />Go to School setup</Link>
    </div>
  );
}

function ErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{(error as Error).message}</p>;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-border/80 bg-card p-5 shadow-xl animate-fade" onMouseDown={(event) => event.stopPropagation()}>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary">Cancel</button>
          <button type="button" disabled={pending} onClick={onConfirm} className="button-lift flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60">
            <Trash2 size={13} />{pending ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Autocomplete over all learners; resolves a typed name back to its learner_id for the API.
function LearnerAutocomplete({ onSelect, placeholder }: { onSelect: (learner: Learner | null) => void; placeholder?: string }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const directoryQuery = useQuery({ queryKey: ['learners', 'directory'], queryFn: () => learnersApi.list() });
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (directoryQuery.data ?? [])
      .filter((learner) => `${learner.first_name} ${learner.last_name}`.toLowerCase().includes(q) || learner.learner_id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, directoryQuery.data]);

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-opacity ${query ? 'opacity-0' : 'opacity-100'}`} />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!event.target.value) onSelect(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder ?? 'Search learner by name'}
          className="field"
          style={{ paddingLeft: query ? undefined : '2rem' }}
        />
      </div>
      {open && query && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {matches.map((learner) => (
            <button
              key={learner.learner_id}
              type="button"
              onMouseDown={() => {
                setQuery(`${learner.first_name} ${learner.last_name}`);
                onSelect(learner);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary"
            >
              <span>{learner.first_name} {learner.last_name}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{learner.learner_id}</span>
            </button>
          ))}
        </div>
      )}
      {open && query && matches.length === 0 && !directoryQuery.isLoading && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-lg">No matching learners</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function Overview() {
  const { schoolId } = useCurrentSchoolId();
  const learnersQuery = useQuery({ queryKey: ['learners'], queryFn: () => learnersApi.list(), enabled: !!schoolId });
  const balancesQuery = useQuery({ queryKey: ['balances'], queryFn: () => balancesApi.list(), enabled: !!schoolId });
  const paymentsQuery = useQuery({ queryKey: ['payments'], queryFn: () => paymentsApi.list(), enabled: !!schoolId });
  const expensesQuery = useQuery({ queryKey: ['expenses', schoolId], queryFn: () => expensesApi.list(schoolId!), enabled: !!schoolId });

  const totalPaid = useMemo(() => (paymentsQuery.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0), [paymentsQuery.data]);
  const totalOutstanding = useMemo(() => (balancesQuery.data ?? []).reduce((sum, item) => sum + Number(item.balance || 0), 0), [balancesQuery.data]);
  const totalExpenses = useMemo(() => (expensesQuery.data ?? []).reduce((sum, item) => sum + Number(item.amount || 0), 0), [expensesQuery.data]);

  return (
    <AppShell>
      <SectionHeading eyebrow="Live overview" title="School finance overview" detail="Data below is fetched live from your Next.js API routes and Postgres database." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Learners" value={String(learnersQuery.data?.length ?? 0)} note="Total learner records" icon={Users} />
            <MetricCard label="Payments received" value={money(totalPaid)} note={`${paymentsQuery.data?.length ?? 0} payment records`} icon={ArrowDownLeft} />
            <MetricCard label="Outstanding balance" value={money(totalOutstanding)} note="Across all charges" icon={CircleDollarSign} />
            <MetricCard label="Expenses logged" value={money(totalExpenses)} note={`${expensesQuery.data?.length ?? 0} records`} icon={ArrowUpRight} />
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Link href="/learners" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Manage learners →</Link>
            <Link href="/payments" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Record a payment →</Link>
            <Link href="/expenses" className="button-lift rounded-xl border border-border/80 bg-card p-4 text-sm font-semibold hover:border-primary/50">Log an expense →</Link>
          </div>
        </>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// School setup
// ---------------------------------------------------------------------------

function useSchoolReferenceData(schoolId: string | null) {
  const genders = useQuery({ queryKey: ['genders', schoolId], queryFn: () => gendersApi.list(schoolId!), enabled: !!schoolId });
  const classCategories = useQuery({ queryKey: ['class_categories', schoolId], queryFn: () => classCategoriesApi.list(schoolId!), enabled: !!schoolId });
  const academicYears = useQuery({ queryKey: ['academic_years', schoolId], queryFn: () => academicYearsApi.list(schoolId!), enabled: !!schoolId });
  const paymentPeriods = useQuery({ queryKey: ['payment_periods', schoolId], queryFn: () => paymentPeriodsApi.list(schoolId!), enabled: !!schoolId });
  const paymentMethods = useQuery({ queryKey: ['payment_methods', schoolId], queryFn: () => paymentMethodsApi.list(schoolId!), enabled: !!schoolId });
  const incomeCategories = useQuery({ queryKey: ['income_categories', schoolId], queryFn: () => incomeCategoriesApi.list(schoolId!), enabled: !!schoolId });
  const expenseCategories = useQuery({ queryKey: ['expense_categories', schoolId], queryFn: () => expenseCategoriesApi.list(schoolId!), enabled: !!schoolId });
  return { genders, classCategories, academicYears, paymentPeriods, paymentMethods, incomeCategories, expenseCategories };
}

function ReferenceListForm<TRow extends Record<string, unknown>>({
  title,
  rows,
  isLoading,
  columns,
  onCreate,
  fields,
}: {
  title: string;
  rows: TRow[] | undefined;
  isLoading: boolean;
  columns: { key: keyof TRow; label: string }[];
  onCreate: (values: Record<string, string>) => Promise<unknown>;
  fields: { name: string; label: string; type?: string }[];
}) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onCreate(values);
      setValues({});
      toast({ title: `${title} added` });
    } catch (error) {
      toast({ title: `Could not add ${title.toLowerCase()}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        {fields.map((field) => (
          <div key={field.name}>
            <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">{field.label}</label>
            <input
              type={field.type ?? 'text'}
              required
              value={values[field.name] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              className="field h-9 w-40 text-xs"
            />
          </div>
        ))}
        <button type="submit" disabled={saving} className="button-lift flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"><Plus size={13} />Add</button>
      </form>
      <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
            <tr>{columns.map((col) => <th key={String(col.key)} className="px-3 py-2 font-semibold">{col.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>Loading…</td></tr>}
            {!isLoading && (rows?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={columns.length}>No records yet</td></tr>}
            {rows?.map((row, index) => (
              <tr key={index}>{columns.map((col) => <td key={String(col.key)} className="px-3 py-2">{String(row[col.key] ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SchoolSetup() {
  const { toast } = useToast();
  const { schoolId, setSchoolId } = useCurrentSchoolId();
  const queryClient = useQueryClient();
  const [lookupId, setLookupId] = useState('');
  const [schoolForm, setSchoolForm] = useState({ school_id: '', school_name: '', school_type: '', school_address: '', school_contact: '', school_email: '' });

  const schoolQuery = useQuery({ queryKey: ['school', schoolId], queryFn: () => schoolsApi.get(schoolId!), enabled: !!schoolId });
  const school: School | undefined = schoolQuery.data?.[0];
  const ref = useSchoolReferenceData(schoolId);

  const createSchool = useMutation({
    mutationFn: () => schoolsApi.create([schoolForm]),
    onSuccess: (result) => {
      const created = result[0];
      setSchoolId(created?.school_id ?? schoolForm.school_id);
      setSchoolForm({ school_id: '', school_name: '', school_type: '', school_address: '', school_contact: '', school_email: '' });
      toast({ title: 'School created', description: `${created?.school_name ?? schoolForm.school_name} is now active.` });
      queryClient.invalidateQueries();
    },
    onError: (error) => toast({ title: 'Could not create school', description: (error as Error).message, variant: 'destructive' }),
  });

  const invalidateRef = (key: string) => queryClient.invalidateQueries({ queryKey: [key, schoolId] });

  const lookupSchool = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await schoolsApi.get(lookupId.trim());
      if (!result || result.length === 0) {
        toast({ title: 'School not found', description: `No school with id "${lookupId}"`, variant: 'destructive' });
        return;
      }
      setSchoolId(lookupId.trim());
      toast({ title: 'School selected', description: `Now viewing ${result[0]?.school_name ?? lookupId}` });
    } catch (error) {
      toast({ title: 'Lookup failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  return (
    <AppShell>
      <SectionHeading eyebrow="Setup" title="School setup" detail="Create a school, or switch to an existing one, then manage the reference data required to add learners and payments." />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/80 bg-card p-5">
          <h3 className="text-sm font-semibold">Create a school</h3>
          <form onSubmit={(event) => { event.preventDefault(); createSchool.mutate(); }} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input required placeholder="School ID (e.g. SCH1)" maxLength={4} value={schoolForm.school_id} onChange={(e) => setSchoolForm((f) => ({ ...f, school_id: e.target.value.toUpperCase() }))} className="field" />
            <input required placeholder="School name" value={schoolForm.school_name} onChange={(e) => setSchoolForm((f) => ({ ...f, school_name: e.target.value }))} className="field" />
            <input required placeholder="School type" value={schoolForm.school_type} onChange={(e) => setSchoolForm((f) => ({ ...f, school_type: e.target.value }))} className="field" />
            <input required placeholder="Address" value={schoolForm.school_address} onChange={(e) => setSchoolForm((f) => ({ ...f, school_address: e.target.value }))} className="field" />
            <input required placeholder="Contact" value={schoolForm.school_contact} onChange={(e) => setSchoolForm((f) => ({ ...f, school_contact: e.target.value }))} className="field" />
            <input required type="email" placeholder="Email" value={schoolForm.school_email} onChange={(e) => setSchoolForm((f) => ({ ...f, school_email: e.target.value }))} className="field" />
            <button type="submit" disabled={createSchool.isPending} className="button-lift col-span-full flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60"><Plus size={15} />{createSchool.isPending ? 'Creating…' : 'Create school'}</button>
          </form>
          <ErrorNotice error={createSchool.error} />
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5">
          <h3 className="text-sm font-semibold">Switch active school</h3>
          <form onSubmit={lookupSchool} className="mt-3 flex gap-2">
            <input placeholder="Enter school ID" value={lookupId} onChange={(e) => setLookupId(e.target.value.toUpperCase())} className="field" />
            <button type="submit" className="button-lift shrink-0 rounded-lg border border-border bg-secondary px-4 text-xs font-semibold">Load</button>
          </form>
          {school && (
            <div className="mt-4 rounded-lg border border-border/60 p-3 text-xs">
              <p className="font-semibold">{school.school_name} ({school.school_id})</p>
              <p className="mt-1 text-muted-foreground">{school.school_type} · {school.school_address}</p>
              <p className="mt-1 text-muted-foreground">{school.school_contact} · {school.school_email}</p>
            </div>
          )}
        </div>
      </div>

      {!schoolId ? <div className="mt-6"><NoSchoolNotice /></div> : (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <ReferenceListForm<Gender>
            title="Genders" rows={ref.genders.data} isLoading={ref.genders.isLoading}
            columns={[{ key: 'gender_id', label: 'ID' }, { key: 'gender_name', label: 'Name' }]}
            fields={[{ name: 'gender_name', label: 'Name' }]}
            onCreate={(values) => gendersApi.create(schoolId, [{ school_id: schoolId, gender_name: values.gender_name }]).then(() => invalidateRef('genders'))}
          />
          <ReferenceListForm<ClassCategory>
            title="Class categories" rows={ref.classCategories.data} isLoading={ref.classCategories.isLoading}
            columns={[{ key: 'class_category_id', label: 'ID' }, { key: 'class_name', label: 'Name' }]}
            fields={[{ name: 'class_name', label: 'Name' }]}
            onCreate={(values) => classCategoriesApi.create(schoolId, [{ school_id: schoolId, class_name: values.class_name }]).then(() => invalidateRef('class_categories'))}
          />
          <ReferenceListForm<AcademicYear>
            title="Academic years" rows={ref.academicYears.data} isLoading={ref.academicYears.isLoading}
            columns={[{ key: 'academic_year_id', label: 'ID' }, { key: 'academic_year_name', label: 'Name' }, { key: 'start_date', label: 'Start' }, { key: 'end_date', label: 'End' }]}
            fields={[{ name: 'academic_year_name', label: 'Name' }, { name: 'start_date', label: 'Start', type: 'date' }, { name: 'end_date', label: 'End', type: 'date' }]}
            onCreate={(values) => academicYearsApi.create(schoolId, [{ school_id: schoolId, academic_year_name: values.academic_year_name, start_date: values.start_date, end_date: values.end_date }]).then(() => invalidateRef('academic_years'))}
          />
          <ReferenceListForm<PaymentPeriod>
            title="Payment periods" rows={ref.paymentPeriods.data} isLoading={ref.paymentPeriods.isLoading}
            columns={[{ key: 'payment_period_id', label: 'ID' }, { key: 'period_name', label: 'Name' }]}
            fields={[{ name: 'period_name', label: 'Name' }]}
            onCreate={(values) => paymentPeriodsApi.create(schoolId, [{ school_id: schoolId, period_name: values.period_name }]).then(() => invalidateRef('payment_periods'))}
          />
          <ReferenceListForm<PaymentMethod>
            title="Payment methods" rows={ref.paymentMethods.data} isLoading={ref.paymentMethods.isLoading}
            columns={[{ key: 'payment_method_id', label: 'ID' }, { key: 'method_name', label: 'Name' }]}
            fields={[{ name: 'method_name', label: 'Name' }]}
            onCreate={(values) => paymentMethodsApi.create(schoolId, [{ school_id: schoolId, method_name: values.method_name }]).then(() => invalidateRef('payment_methods'))}
          />
          <ReferenceListForm<IncomeCategory>
            title="Income categories" rows={ref.incomeCategories.data} isLoading={ref.incomeCategories.isLoading}
            columns={[{ key: 'income_category_id', label: 'ID' }, { key: 'income_name', label: 'Name' }, { key: 'income_limit', label: 'Limit' }]}
            fields={[{ name: 'income_name', label: 'Name' }, { name: 'income_limit', label: 'Limit', type: 'number' }]}
            onCreate={(values) => incomeCategoriesApi.create(schoolId, [{ school_id: schoolId, income_name: values.income_name, income_limit: values.income_limit }]).then(() => invalidateRef('income_categories'))}
          />
          <ReferenceListForm<ExpenseCategory>
            title="Expense categories" rows={ref.expenseCategories.data} isLoading={ref.expenseCategories.isLoading}
            columns={[{ key: 'expense_category_id', label: 'ID' }, { key: 'expense_name', label: 'Name' }]}
            fields={[{ name: 'expense_name', label: 'Name' }]}
            onCreate={(values) => expenseCategoriesApi.create(schoolId, [{ school_id: schoolId, expense_name: values.expense_name }]).then(() => invalidateRef('expense_categories'))}
          />
        </div>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Learners
// ---------------------------------------------------------------------------

function Learners() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [filters, setFilters] = useState({ learner_id: '', class_name: '', gender_name: '', academic_year: '' });
  const [form, setForm] = useState({ first_name: '', last_name: '', gender_id: '', date_of_birth: '', class_category_id: '', academic_year_id: '' });
  const [pendingDelete, setPendingDelete] = useState<Learner | null>(null);

  const learnersQuery = useQuery({
    queryKey: ['learners', filters],
    queryFn: () => learnersApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
    }),
  });

  const createLearner = useMutation({
    mutationFn: (input: CreateLearnerInput) => learnersApi.create([input]),
    onSuccess: () => {
      toast({ title: 'Learner added' });
      setForm({ first_name: '', last_name: '', gender_id: '', date_of_birth: '', class_category_id: '', academic_year_id: '' });
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (error) => toast({ title: 'Could not add learner', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteLearner = useMutation({
    mutationFn: (learnerId: string) => learnersApi.remove(learnerId),
    onSuccess: () => {
      toast({ title: 'Learner deleted' });
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey: ['learners'] });
    },
    onError: (error) => toast({ title: 'Could not delete learner', description: (error as Error).message, variant: 'destructive' }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;
    createLearner.mutate({
      school_id: schoolId,
      first_name: form.first_name,
      last_name: form.last_name,
      gender_id: Number(form.gender_id),
      date_of_birth: form.date_of_birth,
      class_category_id: Number(form.class_category_id),
      academic_year_id: Number(form.academic_year_id),
    });
  };

  return (
    <AppShell>
      <SectionHeading eyebrow="Learners" title="Learner records" detail="Fetched live from GET /api/learners. Filters map directly to the query parameters supported by the API." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Add a learner</h3>
            <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input required placeholder="First name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="field" />
              <input required placeholder="Last name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="field" />
              <input required type="date" value={form.date_of_birth} onChange={(e) => setForm((f) => ({ ...f, date_of_birth: e.target.value }))} className="field" />
              <select required value={form.gender_id} onChange={(e) => setForm((f) => ({ ...f, gender_id: e.target.value }))} className="field">
                <option value="">Gender…</option>
                {ref.genders.data?.map((g) => <option key={g.gender_id} value={g.gender_id}>{g.gender_name}</option>)}
              </select>
              <select required value={form.class_category_id} onChange={(e) => setForm((f) => ({ ...f, class_category_id: e.target.value }))} className="field">
                <option value="">Class…</option>
                {ref.classCategories.data?.map((c) => <option key={c.class_category_id} value={c.class_category_id}>{c.class_name}</option>)}
              </select>
              <select required value={form.academic_year_id} onChange={(e) => setForm((f) => ({ ...f, academic_year_id: e.target.value }))} className="field">
                <option value="">Academic year…</option>
                {ref.academicYears.data?.map((a) => <option key={a.academic_year_id} value={a.academic_year_id}>{a.academic_year_name}</option>)}
              </select>
              <button type="submit" disabled={createLearner.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-3"><Plus size={15} />{createLearner.isPending ? 'Saving…' : 'Add learner'}</button>
            </form>
            {(!ref.genders.data?.length || !ref.classCategories.data?.length || !ref.academicYears.data?.length) && (
              <p className="mt-3 text-xs text-muted-foreground">Add at least one gender, class category and academic year in School setup before adding learners.</p>
            )}
            <ErrorNotice error={createLearner.error} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-56"><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label><input value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} placeholder="e.g. Grade 4" className="field h-9 w-36 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label><input value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} placeholder="e.g. Female" className="field h-9 w-36 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label><input value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} placeholder="e.g. 2026" className="field h-9 w-36 text-xs" /></div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2 font-semibold">Learner ID</th><th className="px-3 py-2 font-semibold">Name</th><th className="px-3 py-2 font-semibold">Gender</th><th className="px-3 py-2 font-semibold">Class</th><th className="px-3 py-2 font-semibold">Year</th><th className="px-3 py-2 font-semibold"></th></tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {learnersQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
                  {!learnersQuery.isLoading && (learnersQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No learners found</td></tr>}
                  {learnersQuery.data?.map((learner) => (
                    <tr key={learner.learner_id} data-testid={`row-learner-${learner.learner_id}`}>
                      <td className="px-3 py-2 font-mono">{learner.learner_id}</td>
                      <td className="px-3 py-2">{learner.first_name} {learner.last_name}</td>
                      <td className="px-3 py-2">{learner.gender_name}</td>
                      <td className="px-3 py-2">{learner.class_name}</td>
                      <td className="px-3 py-2">{learner.curent_year}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          title="Delete this learner"
                          onClick={() => setPendingDelete(learner)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ErrorNotice error={learnersQuery.error} />
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this learner?"
        description={pendingDelete ? `${pendingDelete.first_name} ${pendingDelete.last_name} (${pendingDelete.learner_id}) will be removed from active records.` : undefined}
        pending={deleteLearner.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => { if (pendingDelete) deleteLearner.mutate(pendingDelete.learner_id); }}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Payments & balances
// ---------------------------------------------------------------------------

function Payments() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [tab, setTab] = useState<'payments' | 'balances'>('payments');
  const [filters, setFilters] = useState({
    learner_id: '',
    class_name: '',
    gender_name: '',
    academic_year: '',
    income_name: '',
    payment_period: '',
    method_name: '',
  });
  const [form, setForm] = useState({ learner_id: '', enrolment_id: '', payment_period_id: '', payment_method_id: '', income_category_id: '', amount: '' });
  const [pendingDeletePayment, setPendingDeletePayment] = useState<Payment | null>(null);

  const paymentsQuery = useQuery({
    queryKey: ['payments', filters],
    queryFn: () => paymentsApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
      income_name: filters.income_name || null,
      payment_period: filters.payment_period || null,
      method_name: filters.method_name || null,
    }),
    enabled: tab === 'payments',
  });
  const balancesQuery = useQuery({
    queryKey: ['balances', filters],
    queryFn: () => balancesApi.list({
      learner_id: filters.learner_id || null,
      class_name: filters.class_name || null,
      gender_name: filters.gender_name || null,
      academic_year: filters.academic_year || null,
      income_name: filters.income_name || null,
      payment_period: filters.payment_period || null,
    }),
    enabled: tab === 'balances',
  });

  const recordPayment = useMutation({
    mutationFn: (input: CreateChargesWithPaymentsInput) => paymentsApi.create(input),
    onSuccess: () => {
      toast({ title: 'Payment recorded' });
      setForm({ learner_id: '', enrolment_id: '', payment_period_id: '', payment_method_id: '', income_category_id: '', amount: '' });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (error) => toast({ title: 'Payment failed', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteCharge = useMutation({
    mutationFn: (id: number) => paymentsApi.deleteCharge(id),
    onSuccess: () => {
      toast({ title: 'Charge deleted' });
      setPendingDeletePayment(null);
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (error) => toast({ title: 'Delete failed', description: (error as Error).message, variant: 'destructive' }),
  });

  const submitPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!schoolId) return;
    if (!form.learner_id) {
      toast({ title: 'Select a learner first', variant: 'destructive' });
      return;
    }
    const academicYearId = ref.academicYears.data?.[0]?.academic_year_id;
    if (!academicYearId) {
      toast({ title: 'Add an academic year first', variant: 'destructive' });
      return;
    }
    recordPayment.mutate({
      learner_id: form.learner_id,
      enrolment_id: Number(form.enrolment_id),
      payment_period_id: Number(form.payment_period_id),
      academic_year_id: academicYearId,
      payment_method_id: Number(form.payment_method_id),
      income_categories: [{ income_category_id: Number(form.income_category_id), amount: Number(form.amount) }],
    });
  };

  return (
    <AppShell>
      <SectionHeading eyebrow="Payments" title="Payments & balances" detail="Payments are created as charges + allocations via POST /api/learners/payments." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Record a payment</h3>
            <form onSubmit={submitPayment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <LearnerAutocomplete placeholder="Search learner by name…" onSelect={(learner) => setForm((f) => ({ ...f, learner_id: learner?.learner_id ?? '', enrolment_id: learner ? String(learner.enrolment_id) : '' }))} />
                {form.learner_id && <p className="mt-1 font-mono text-[10px] text-muted-foreground">Learner ID: {form.learner_id}</p>}
              </div>
              <input required type="number" placeholder="Enrolment ID" readOnly value={form.enrolment_id} className="field bg-secondary/40" />
              <select required value={form.payment_period_id} onChange={(e) => setForm((f) => ({ ...f, payment_period_id: e.target.value }))} className="field">
                <option value="">Payment period…</option>
                {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.payment_period_id}>{p.period_name}</option>)}
              </select>
              <select required value={form.payment_method_id} onChange={(e) => setForm((f) => ({ ...f, payment_method_id: e.target.value }))} className="field">
                <option value="">Payment method…</option>
                {ref.paymentMethods.data?.map((p) => <option key={p.payment_method_id} value={p.payment_method_id}>{p.method_name}</option>)}
              </select>
              <select required value={form.income_category_id} onChange={(e) => setForm((f) => ({ ...f, income_category_id: e.target.value }))} className="field">
                <option value="">Income category…</option>
                {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_category_id}>{i.income_name}</option>)}
              </select>
              <input required type="number" min="1" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="field" />
              <button type="submit" disabled={recordPayment.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-3"><Plus size={15} />{recordPayment.isPending ? 'Saving…' : 'Record payment'}</button>
            </form>
            <p className="mt-2 text-[11px] text-muted-foreground">Uses the first available academic year record. Enrolment ID fills in automatically once a learner is selected.</p>
            <ErrorNotice error={recordPayment.error} />
          </div>

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex rounded-lg border border-border p-1 text-xs font-semibold">
                <button type="button" onClick={() => setTab('payments')} className={`rounded-md px-3 py-1.5 ${tab === 'payments' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Payments</button>
                <button type="button" onClick={() => setTab('balances')} className={`rounded-md px-3 py-1.5 ${tab === 'balances' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>Balances</button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Learner name</label><LearnerAutocomplete placeholder="Search by name…" onSelect={(learner) => setFilters((f) => ({ ...f, learner_id: learner?.learner_id ?? '' }))} /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Class</label><input value={filters.class_name} onChange={(e) => setFilters((f) => ({ ...f, class_name: e.target.value }))} placeholder="e.g. Grade 4" className="field h-9 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Gender</label><input value={filters.gender_name} onChange={(e) => setFilters((f) => ({ ...f, gender_name: e.target.value }))} placeholder="e.g. Female" className="field h-9 text-xs" /></div>
              <div><label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Academic year</label><input value={filters.academic_year} onChange={(e) => setFilters((f) => ({ ...f, academic_year: e.target.value }))} placeholder="e.g. 2026" className="field h-9 text-xs" /></div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Income category</label>
                <select value={filters.income_name} onChange={(e) => setFilters((f) => ({ ...f, income_name: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.incomeCategories.data?.map((i) => <option key={i.income_category_id} value={i.income_name}>{i.income_name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment period</label>
                <select value={filters.payment_period} onChange={(e) => setFilters((f) => ({ ...f, payment_period: e.target.value }))} className="field h-9 text-xs">
                  <option value="">All</option>
                  {ref.paymentPeriods.data?.map((p) => <option key={p.payment_period_id} value={p.period_name}>{p.period_name}</option>)}
                </select>
              </div>
              {tab === 'payments' && (
                <div>
                  <label className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment method</label>
                  <select value={filters.method_name} onChange={(e) => setFilters((f) => ({ ...f, method_name: e.target.value }))} className="field h-9 text-xs">
                    <option value="">All</option>
                    {ref.paymentMethods.data?.map((m) => <option key={m.payment_method_id} value={m.method_name}>{m.method_name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {tab === 'payments' && (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2 font-semibold">Learner</th><th className="px-3 py-2 font-semibold">Income</th><th className="px-3 py-2 font-semibold">Period</th><th className="px-3 py-2 font-semibold">Method</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {paymentsQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>Loading…</td></tr>}
                    {!paymentsQuery.isLoading && (paymentsQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={6}>No payments found</td></tr>}
                    {paymentsQuery.data?.map((payment, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2">{payment.first_name} {payment.last_name}</td>
                        <td className="px-3 py-2">{payment.income_name}</td>
                        <td className="px-3 py-2">{payment.period_name}</td>
                        <td className="px-3 py-2">{payment.method_name}</td>
                        <td className="px-3 py-2 font-semibold">{money(payment.amount)}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            title="Delete this payment"
                            disabled={deleteCharge.isPending}
                            onClick={() => setPendingDeletePayment(payment)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ErrorNotice error={paymentsQuery.error} />
              </div>
            )}

            {tab === 'balances' && (
              <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-left text-xs">
                  <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2 font-semibold">Learner</th><th className="px-3 py-2 font-semibold">Income</th><th className="px-3 py-2 font-semibold">Charged</th><th className="px-3 py-2 font-semibold">Paid</th><th className="px-3 py-2 font-semibold">Balance</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {balancesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                    {!balancesQuery.isLoading && (balancesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No balances found</td></tr>}
                    {balancesQuery.data?.map((balance, index) => (
                      <tr key={index}>
                        <td className="px-3 py-2">{balance.first_name} {balance.last_name}</td>
                        <td className="px-3 py-2">{balance.income_name}</td>
                        <td className="px-3 py-2">{money(balance.charged)}</td>
                        <td className="px-3 py-2">{money(balance.paid)}</td>
                        <td className={`px-3 py-2 font-semibold ${Number(balance.balance) > 0 ? 'text-destructive' : 'text-primary'}`}>{money(balance.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ErrorNotice error={balancesQuery.error} />
              </div>
            )}
            <ErrorNotice error={deleteCharge.error} />
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!pendingDeletePayment}
        title="Delete this payment?"
        description={pendingDeletePayment ? `The ${pendingDeletePayment.income_name} payment of ${money(pendingDeletePayment.amount)} for ${pendingDeletePayment.first_name} ${pendingDeletePayment.last_name} will be removed.` : undefined}
        pending={deleteCharge.isPending}
        onCancel={() => setPendingDeletePayment(null)}
        onConfirm={() => { if (pendingDeletePayment) deleteCharge.mutate(pendingDeletePayment.charge_id); }}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

function Expenses() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const ref = useSchoolReferenceData(schoolId);
  const [form, setForm] = useState({ expense_category_id: '', amount: '', expense_date: '', description: '' });
  const [pendingDeleteExpense, setPendingDeleteExpense] = useState<Expense | null>(null);

  const expensesQuery = useQuery({ queryKey: ['expenses', schoolId], queryFn: () => expensesApi.list(schoolId!), enabled: !!schoolId });

  const categoryName = (id: number) => ref.expenseCategories.data?.find((c) => c.expense_category_id === id)?.expense_name ?? '—';

  const createExpense = useMutation({
    mutationFn: () => expensesApi.create(schoolId!, [{ expense_category_id: form.expense_category_id, amount: Number(form.amount), expense_date: form.expense_date, description: form.description }]),
    onSuccess: () => {
      toast({ title: 'Expense logged' });
      setForm({ expense_category_id: '', amount: '', expense_date: '', description: '' });
      queryClient.invalidateQueries({ queryKey: ['expenses', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not log expense', description: (error as Error).message, variant: 'destructive' }),
  });

  const deleteExpense = useMutation({
    mutationFn: (expenseId: number) => expensesApi.remove(schoolId!, expenseId),
    onSuccess: () => {
      toast({ title: 'Expense deleted' });
      setPendingDeleteExpense(null);
      queryClient.invalidateQueries({ queryKey: ['expenses', schoolId] });
    },
    onError: (error) => toast({ title: 'Could not delete expense', description: (error as Error).message, variant: 'destructive' }),
  });

  return (
    <AppShell>
      <SectionHeading eyebrow="Expenses" title="Expenses" detail="Backed by GET/POST /api/schools/[school_id]/expenses." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="rounded-2xl border border-border/80 bg-card p-5">
            <h3 className="text-sm font-semibold">Log an expense</h3>
            <form onSubmit={(event) => { event.preventDefault(); createExpense.mutate(); }} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <select required value={form.expense_category_id} onChange={(e) => setForm((f) => ({ ...f, expense_category_id: e.target.value }))} className="field">
                <option value="">Category…</option>
                {ref.expenseCategories.data?.map((c) => <option key={c.expense_category_id} value={c.expense_category_id}>{c.expense_name}</option>)}
              </select>
              <input required type="number" min="1" placeholder="Amount" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className="field" />
              <input required type="date" value={form.expense_date} onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))} className="field" />
              <input required placeholder="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="field" />
              <button type="submit" disabled={createExpense.isPending} className="button-lift flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60 sm:col-span-2 lg:col-span-4"><Plus size={15} />{createExpense.isPending ? 'Saving…' : 'Log expense'}</button>
            </form>
            <ErrorNotice error={createExpense.error} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-border/80 bg-card p-5">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Description</th><th className="px-3 py-2 font-semibold">Amount</th><th className="px-3 py-2 font-semibold"></th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {expensesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                {!expensesQuery.isLoading && (expensesQuery.data?.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No expenses found</td></tr>}
                {expensesQuery.data?.map((expense) => (
                  <tr key={expense.expense_id}>
                    <td className="px-3 py-2">{expense.expense_date ? new Date(expense.expense_date).toLocaleDateString('en-GB') : ''}</td>
                    <td className="px-3 py-2">{categoryName(expense.expense_category_id)}</td>
                    <td className="px-3 py-2">{expense.description}</td>
                    <td className="px-3 py-2 font-semibold">{money(expense.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        title="Delete this expense"
                        disabled={deleteExpense.isPending}
                        onClick={() => setPendingDeleteExpense(expense)}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ErrorNotice error={expensesQuery.error} />
          </div>
        </>
      )}
      <ConfirmDialog
        open={!!pendingDeleteExpense}
        title="Delete this expense?"
        description={pendingDeleteExpense ? `The ${categoryName(pendingDeleteExpense.expense_category_id)} expense of ${money(pendingDeleteExpense.amount)} will be removed.` : undefined}
        pending={deleteExpense.isPending}
        onCancel={() => setPendingDeleteExpense(null)}
        onConfirm={() => { if (pendingDeleteExpense) deleteExpense.mutate(pendingDeleteExpense.expense_id); }}
      />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  payments: 'Payments',
  owing: 'Owing',
  expenses: 'Expenses',
};

function formatReportDate(value: string) {
  // Values from the reports API are plain 'YYYY-MM-DD' (or 'YYYY-MM-DD HH:MM:SS')
  // strings, deliberately not JS Date objects, so no timezone reinterpretation happens.
  return value.slice(0, 10).split('-').reverse().join('/');
}

function Reports() {
  const { schoolId } = useCurrentSchoolId();
  const { toast } = useToast();
  const [reportType, setReportType] = useState<ReportType>('payments');
  const [dateMode, setDateMode] = useState<'specific' | 'all'>('all');
  const [specificDate, setSpecificDate] = useState('');
  const [downloading, setDownloading] = useState(false);

  const date: ReportDate = dateMode === 'specific' && specificDate ? specificDate : null;
  const waitingForDate = dateMode === 'specific' && !specificDate;
  const queriesEnabled = !!schoolId && !waitingForDate;

  const summaryQuery = useQuery({
    queryKey: ['reports-summary', schoolId, date],
    queryFn: () => reportsApi.summary(schoolId!, date),
    enabled: queriesEnabled,
  });
  const paymentsQuery = useQuery({
    queryKey: ['reports-payments', schoolId, date],
    queryFn: () => reportsApi.payments(schoolId!, date),
    enabled: queriesEnabled && reportType === 'payments',
  });
  const owingQuery = useQuery({
    queryKey: ['reports-owing', schoolId, date],
    queryFn: () => reportsApi.owing(schoolId!, date),
    enabled: queriesEnabled && reportType === 'owing',
  });
  const expensesQuery = useQuery({
    queryKey: ['reports-expenses', schoolId, date],
    queryFn: () => reportsApi.expenses(schoolId!, date),
    enabled: queriesEnabled && reportType === 'expenses',
  });

  const activeQuery = reportType === 'payments' ? paymentsQuery : reportType === 'owing' ? owingQuery : expensesQuery;
  const dateLabel = date ? `Specific Date: ${formatReportDate(date)}` : 'All Dates';

  const handleDownload = async () => {
    if (!schoolId || waitingForDate) return;
    setDownloading(true);
    try {
      await reportsApi.downloadPdf(schoolId, reportType, date);
      toast({ title: 'PDF downloaded' });
    } catch (error) {
      toast({ title: 'Could not generate PDF', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <AppShell>
      <SectionHeading eyebrow="Reports" title="Reports" detail="Payments, owing balances, and expenses — backed by GET /api/schools/[school_id]/reports/[type]." />
      {!schoolId ? <NoSchoolNotice /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Total received" value={money(summaryQuery.data?.totalPayments ?? 0)} note={dateLabel} icon={ArrowDownLeft} />
            <MetricCard label="Total outstanding" value={money(summaryQuery.data?.totalOutstanding ?? 0)} note={dateLabel} icon={CircleDollarSign} />
            <MetricCard label="Total expenses" value={money(summaryQuery.data?.totalExpenses ?? 0)} note={dateLabel} icon={ArrowUpRight} />
            <MetricCard label="Net position" value={money(summaryQuery.data?.netPosition ?? 0)} note="Payments − Expenses" icon={FileBarChart} />
          </div>
          <ErrorNotice error={summaryQuery.error} />

          <div className="mt-6 rounded-2xl border border-border/80 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex rounded-lg border border-border p-1 text-xs font-semibold">
                {(Object.keys(REPORT_TYPE_LABELS) as ReportType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setReportType(type)}
                    className={`rounded-md px-3 py-1.5 ${reportType === type ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                  >
                    {REPORT_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <input type="radio" name="report-date-mode" checked={dateMode === 'all'} onChange={() => setDateMode('all')} />
                  All Dates
                </label>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <input type="radio" name="report-date-mode" checked={dateMode === 'specific'} onChange={() => setDateMode('specific')} />
                  Specific Date
                </label>
                {dateMode === 'specific' && (
                  <input type="date" value={specificDate} onChange={(e) => setSpecificDate(e.target.value)} className="field h-9 text-xs" />
                )}
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={downloading || waitingForDate}
                  className="button-lift flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                >
                  <Download size={14} />{downloading ? 'Preparing…' : `Download ${REPORT_TYPE_LABELS[reportType]} PDF`}
                </button>
              </div>
            </div>

            <p className="mt-4 text-xs font-semibold text-foreground" data-testid="text-report-date-scope">
              Viewing: {dateLabel}
            </p>

            {waitingForDate ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-3 text-xs text-muted-foreground">Select a date to view this report.</p>
            ) : (
              <>
                {reportType === 'payments' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Customer</th><th className="px-3 py-2 font-semibold">Class</th><th className="px-3 py-2 font-semibold">Method</th><th className="px-3 py-2 font-semibold">Amount</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {paymentsQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
                        {!paymentsQuery.isLoading && (paymentsQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={5}>No payments found for the selected period.</td></tr>}
                        {paymentsQuery.data?.rows.map((row) => (
                          <tr key={row.payment_id}>
                            <td className="px-3 py-2">{formatReportDate(row.paid_at_local)}</td>
                            <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                            <td className="px-3 py-2">{row.class_name}</td>
                            <td className="px-3 py-2">{row.method_name}</td>
                            <td className="px-3 py-2 font-semibold">{money(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(paymentsQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={4}>Total Payments</td>
                            <td className="px-3 py-2">{money(paymentsQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {reportType === 'owing' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Student</th><th className="px-3 py-2 font-semibold">Account</th><th className="px-3 py-2 font-semibold">Fee</th><th className="px-3 py-2 font-semibold">Expected</th><th className="px-3 py-2 font-semibold">Paid</th><th className="px-3 py-2 font-semibold">Outstanding</th><th className="px-3 py-2 font-semibold">Status</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {owingQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>Loading…</td></tr>}
                        {!owingQuery.isLoading && (owingQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={7}>No outstanding balances found for the selected period.</td></tr>}
                        {owingQuery.data?.rows.map((row) => (
                          <tr key={row.charge_id}>
                            <td className="px-3 py-2">{row.first_name} {row.last_name}</td>
                            <td className="px-3 py-2 font-mono text-[11px]">{row.learner_id}</td>
                            <td className="px-3 py-2">{row.income_name}</td>
                            <td className="px-3 py-2">{money(row.expected)}</td>
                            <td className="px-3 py-2">{money(row.paid)}</td>
                            <td className="px-3 py-2 font-semibold text-destructive">{money(row.balance)}</td>
                            <td className="px-3 py-2">{row.status}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(owingQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={5}>Total Outstanding</td>
                            <td className="px-3 py-2 text-destructive" colSpan={2}>{money(owingQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}

                {reportType === 'expenses' && (
                  <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-secondary/60 text-[10px] uppercase text-muted-foreground">
                        <tr><th className="px-3 py-2 font-semibold">Date</th><th className="px-3 py-2 font-semibold">Category</th><th className="px-3 py-2 font-semibold">Description</th><th className="px-3 py-2 font-semibold">Amount</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {expensesQuery.isLoading && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>Loading…</td></tr>}
                        {!expensesQuery.isLoading && (expensesQuery.data?.rows.length ?? 0) === 0 && <tr><td className="px-3 py-3 text-muted-foreground" colSpan={4}>No expenses found for the selected period.</td></tr>}
                        {expensesQuery.data?.rows.map((row) => (
                          <tr key={row.expense_id}>
                            <td className="px-3 py-2">{formatReportDate(row.expense_date)}</td>
                            <td className="px-3 py-2">{row.category_name}</td>
                            <td className="px-3 py-2">{row.description}</td>
                            <td className="px-3 py-2 font-semibold">{money(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {(expensesQuery.data?.rows.length ?? 0) > 0 && (
                        <tfoot>
                          <tr className="border-t border-border/80 bg-secondary/30 font-semibold">
                            <td className="px-3 py-2" colSpan={3}>Total Expenses</td>
                            <td className="px-3 py-2">{money(expensesQuery.data!.total)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
                <ErrorNotice error={activeQuery.error} />
              </>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Router / root
// ---------------------------------------------------------------------------

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Overview} />
      <Route path="/school" component={SchoolSetup} />
      <Route path="/learners" component={Learners} />
      <Route path="/payments" component={Payments} />
      <Route path="/expenses" component={Expenses} />
      <Route path="/reports" component={Reports} />
      <Route>{() => <Overview />}</Route>
    </Switch>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter ssrPath="/">
            <AppRouter />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
