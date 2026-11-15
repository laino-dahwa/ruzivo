/**
 * The read-only website: server-rendered pages over the D1 mirror. Only
 * SELECTs happen here; every row is written by the desktop sync.
 */
import type { Database } from './sync';
import type { Viewer } from './access';

export type SiteEnv = { TIMEZONE?: string };

type Row = Record<string, unknown>;

// ── Formatting ──────────────────────────────────────────────────────────────

const esc = (value: unknown) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (cents: unknown) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents ?? 0) / 100);

function zone(env: SiteEnv) {
  return env.TIMEZONE || 'Africa/Harare';
}

function when(iso: unknown, env: SiteEnv, withTime = true) {
  if (!iso) return '—';
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return esc(iso);
  return date.toLocaleString('en-GB', {
    timeZone: zone(env),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Minutes the zone is ahead of UTC at `at`. */
function offsetMinutes(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "YYYY-MM-DD" in the school's zone. */
function localDate(at: Date, env: SiteEnv) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone(env) }).format(at);
}

/** The UTC instant a local "YYYY-MM-DD" day starts, as stored timestamps compare. */
function dayStartUtc(day: string, env: SiteEnv) {
  const naive = new Date(`${day}T00:00:00Z`);
  return new Date(naive.getTime() - offsetMinutes(naive, zone(env)) * 60000).toISOString();
}

function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const validDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

// ── Layout ──────────────────────────────────────────────────────────────────

const STYLE = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1c1b19;--muted:#6b6862;--line:#e4e1da;--accent:#2f6b4f;--accent-soft:#e3efe8;--warn:#9a5b13;--warn-soft:#f8ecd9;--bad:#a33a2c;--bad-soft:#f7e2de}
@media (prefers-color-scheme:dark){:root{--bg:#141412;--card:#1d1c1a;--ink:#ecebe7;--muted:#a19d95;--line:#2f2d29;--accent:#7cc39d;--accent-soft:#1f3328;--warn:#e0a85a;--warn-soft:#3a2c18;--bad:#ec8b7d;--bad-soft:#3d211d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:inherit}header{background:var(--card);border-bottom:1px solid var(--line)}
.bar{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.brand{display:flex;gap:10px;align-items:center;font-weight:650;text-decoration:none}.brand img{width:32px;height:32px;border-radius:8px;object-fit:contain}
nav{display:flex;gap:4px;flex-wrap:wrap}nav a{padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--muted)}nav a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.who{margin-left:auto;color:var(--muted);font-size:12px}
main{max-width:1100px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:4px 0 4px;letter-spacing:-.02em}h2{font-size:15px;margin:28px 0 10px}.sub{color:var(--muted);margin:0 0 18px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:22px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stat span{color:var(--muted);font-size:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600}tr:last-child td{border-bottom:0}td.n,th.n{text-align:right}
.pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600}.ok{background:var(--accent-soft);color:var(--accent)}.part{background:var(--warn-soft);color:var(--warn)}.none{background:var(--bad-soft);color:var(--bad)}
form.filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}input,select,button{font:inherit;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}button{background:var(--accent);color:var(--card);border-color:var(--accent);font-weight:600;cursor:pointer}
.empty{padding:18px;color:var(--muted)}.foot{color:var(--muted);font-size:12px;margin-top:28px}
`;

function page(opts: { title: string; active: string; school: Row | null; schools: Row[]; viewer: Viewer; lastSync: unknown; env: SiteEnv; body: string }) {
  const s = opts.school;
  const q = s ? `?school=${encodeURIComponent(String(s.school_id))}` : '';
  const link = (path: string, label: string, key: string) => `<a href="${path}${q}" class="${opts.active === key ? 'on' : ''}">${label}</a>`;
  const switcher =
    opts.schools.length > 1
      ? `<form method="get"><select name="school" onchange="this.form.submit()">${opts.schools
          .map((x) => `<option value="${esc(x.school_id)}"${x.school_id === s?.school_id ? ' selected' : ''}>${esc(x.school_name)}</option>`)
          .join('')}</select></form>`
      : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)} · ${esc(s?.school_name ?? 'School')}</title><meta name="robots" content="noindex"><style>${STYLE}</style></head><body>
<header><div class="bar"><a class="brand" href="/${q}">${s ? `<img src="/logo/${encodeURIComponent(String(s.school_id))}" alt="" onerror="this.remove()">` : ''}${esc(s?.school_name ?? 'School')}</a>
<nav>${link('/', 'Overview', 'home')}${link('/learners', 'Learners', 'learners')}${link('/payments', 'Payments', 'payments')}${link('/expenses', 'Expenses', 'expenses')}${link('/staff', 'Staff', 'staff')}</nav>
${switcher}<span class="who">${esc(opts.viewer.email)}</span></div></header>
<main>${opts.body}<p class="foot">Read-only copy. Last updated from the school computer ${when(opts.lastSync, opts.env)}.</p></main></body></html>`;
}

function table(headers: string[], rows: string[][], numeric: number[] = []) {
  if (rows.length === 0) return '<div class="card"><p class="empty">Nothing to show.</p></div>';
  const cell = (tag: string, i: number, v: string) => `<${tag}${numeric.includes(i) ? ' class="n"' : ''}>${v}</${tag}>`;
  return `<div class="card"><table><thead><tr>${headers.map((h, i) => cell('th', i, h)).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((v, i) => cell('td', i, v)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const statusPill = (status: unknown) =>
  status === 'FULLY_PAID'
    ? '<span class="pill ok">Paid</span>'
    : status === 'PARTIALLY_PAID'
      ? '<span class="pill part">Part paid</span>'
      : '<span class="pill none">Not paid</span>';

// ── Pages ───────────────────────────────────────────────────────────────────

async function all(db: Database, sql: string, ...params: unknown[]): Promise<Row[]> {
  return (await db.prepare(sql).bind(...params).all<Row>()).results;
}
async function one(db: Database, sql: string, ...params: unknown[]): Promise<Row> {
  return (await db.prepare(sql).bind(...params).first<Row>()) ?? {};
}

export async function renderSite(request: Request, db: Database, env: SiteEnv, viewer: Viewer): Promise<Response> {
  const url = new URL(request.url);
  const schools = await all(db, 'SELECT school_id, school_name FROM schools ORDER BY school_name');
  const school = schools.find((s) => s.school_id === url.searchParams.get('school')) ?? schools[0] ?? null;
  const lastSync = (await one(db, 'SELECT max(last_batch_at) AS at FROM sync_installs')).at;
  const html = (title: string, active: string, body: string, status = 200) =>
    new Response(page({ title, active, school, schools, viewer, lastSync, env, body }), {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' },
    });

  if (!school) return html('Waiting for data', 'home', '<h1>No data yet</h1><p class="sub">Link the school computer to this website from Setup → Cloud website in the desktop app.</p>');
  const sid = school.school_id;
  const q = `school=${encodeURIComponent(String(sid))}`;
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    const today = localDate(new Date(), env);
    const monthStart = `${today.slice(0, 7)}-01`;
    const [counts, todayTake, monthTake, monthSpend, owing, recent, days] = await Promise.all([
      one(db, 'SELECT count(*) AS learners FROM learners WHERE school_id = ? AND deleted_at IS NULL', sid),
      one(db, 'SELECT count(*) AS n, coalesce(sum(amount_cents),0) AS c FROM payments WHERE school_id = ? AND paid_at >= ?', sid, dayStartUtc(today, env)),
      one(db, 'SELECT coalesce(sum(amount_cents),0) AS c FROM payments WHERE school_id = ? AND paid_at >= ?', sid, dayStartUtc(monthStart, env)),
      one(db, 'SELECT coalesce(sum(amount_cents),0) AS c FROM expenses WHERE school_id = ? AND expense_date >= ?', sid, monthStart),
      one(db, 'SELECT coalesce(sum(total_owing_cents),0) AS c, sum(total_owing_cents > 0) AS n FROM v_learner_balances WHERE school_id = ?', sid),
      all(db, 'SELECT * FROM v_payment_lines WHERE school_id = ? ORDER BY paid_at DESC, payment_id DESC LIMIT 12', sid),
      all(db, 'SELECT paid_at, amount_cents FROM payments WHERE school_id = ? AND paid_at >= ?', sid, dayStartUtc(addDays(today, -13), env)),
    ]);
    const byDay = new Map<string, { n: number; c: number }>();
    for (const p of days) {
      const day = localDate(new Date(String(p.paid_at)), env);
      const entry = byDay.get(day) ?? { n: 0, c: 0 };
      entry.n++;
      entry.c += Number(p.amount_cents);
      byDay.set(day, entry);
    }
    const body = `<h1>Overview</h1><p class="sub">${esc(school.school_name)}</p>
<div class="stats">
<div class="stat"><b>${money(todayTake.c)}</b><span>Collected today · ${Number(todayTake.n)} payment${Number(todayTake.n) === 1 ? '' : 's'}</span></div>
<div class="stat"><b>${money(monthTake.c)}</b><span>Collected this month</span></div>
<div class="stat"><b>${money(monthSpend.c)}</b><span>Spent this month</span></div>
<div class="stat"><b>${money(owing.c)}</b><span>Owing · ${Number(owing.n ?? 0)} learners</span></div>
<div class="stat"><b>${Number(counts.learners).toLocaleString()}</b><span>Learners</span></div>
</div>
<h2>Recent payments</h2>${paymentsTable(recent, env, q)}
<h2>Last 14 days</h2>${table(
      ['Day', 'Payments', 'Collected'],
      Array.from({ length: 14 }, (_, i) => addDays(today, -i)).map((d) => [when(`${d}T12:00:00Z`, env, false), String(byDay.get(d)?.n ?? 0), money(byDay.get(d)?.c ?? 0)]),
      [1, 2]
    )}`;
    return html('Overview', 'home', body);
  }

  if (path === '/learners') {
    const search = (url.searchParams.get('q') ?? '').trim();
    const like = `%${search.replace(/[%_]/g, '')}%`;
    const rows = await all(
      db,
      `SELECT l.learner_id, l.first_name, l.last_name, cc.class_name,
              coalesce(b.total_owing_cents, 0) AS owing, coalesce(b.paid_cents, 0) AS paid
       FROM learners l
       LEFT JOIN enrolments e ON e.enrolment_id = (SELECT e2.enrolment_id FROM enrolments e2 JOIN academic_years ay ON ay.academic_year_id = e2.academic_year_id
                                                   WHERE e2.learner_id = l.learner_id ORDER BY ay.start_date DESC LIMIT 1)
       LEFT JOIN class_categories cc ON cc.class_category_id = e.class_category_id
       LEFT JOIN v_learner_balances b ON b.learner_id = l.learner_id
       WHERE l.school_id = ? AND l.deleted_at IS NULL
         AND (? = '' OR l.first_name || ' ' || l.last_name LIKE ? OR l.learner_id LIKE ?)
       ORDER BY owing DESC, l.last_name, l.first_name`,
      sid, search, like, like
    );
    const body = `<h1>Learners</h1><p class="sub">${rows.length} learner${rows.length === 1 ? '' : 's'}, most owing first.</p>
<form class="filters" method="get"><input type="hidden" name="school" value="${esc(sid)}"><input name="q" placeholder="Name or learner id" value="${esc(search)}"><button>Search</button></form>
${table(
      ['Learner', 'Id', 'Class', 'Paid', 'Owing'],
      rows.map((r) => [
        `<a href="/learners/${encodeURIComponent(String(r.learner_id))}?${q}">${esc(r.first_name)} ${esc(r.last_name)}</a>`,
        esc(r.learner_id),
        esc(r.class_name ?? '—'),
        money(r.paid),
        Number(r.owing) > 0 ? `<b>${money(r.owing)}</b>` : '<span class="pill ok">Paid up</span>',
      ]),
      [3, 4]
    )}`;
    return html('Learners', 'learners', body);
  }

  const learnerMatch = /^\/learners\/([^/]+)$/.exec(path);
  if (learnerMatch) {
    const id = decodeURIComponent(learnerMatch[1]);
    const learner = await one(
      db,
      `SELECT l.*, g.gender_name FROM learners l LEFT JOIN genders g ON g.gender_id = l.gender_id WHERE l.learner_id = ? AND l.school_id = ?`,
      id, sid
    );
    if (!learner.learner_id) return html('Not found', 'learners', '<h1>Learner not found</h1>', 404);
    const [obligations, payments] = await Promise.all([
      all(
        db,
        `SELECT * FROM v_obligations WHERE learner_id = ?
         ORDER BY CASE WHEN balance_cents > 0 THEN 0 ELSE 1 END, academic_year_name DESC, priority, income_name, payment_period_id`,
        id
      ),
      all(db, 'SELECT * FROM v_payment_lines WHERE learner_id = ? ORDER BY paid_at DESC, payment_id DESC', id),
    ]);
    const owing = obligations.reduce((sum, o) => sum + Math.max(0, Number(o.balance_cents)), 0);
    const paid = payments.reduce((sum, p) => sum + Number(p.amount_cents), 0);
    const body = `<p class="sub"><a href="/learners?${q}">← Learners</a></p><h1>${esc(learner.first_name)} ${esc(learner.last_name)}</h1>
<p class="sub">${esc(learner.learner_id)}${learner.gender_name ? ` · ${esc(learner.gender_name)}` : ''}${learner.date_of_birth ? ` · born ${when(`${learner.date_of_birth}T12:00:00Z`, env, false)}` : ''}</p>
<div class="stats"><div class="stat"><b>${money(owing)}</b><span>Owing</span></div><div class="stat"><b>${money(paid)}</b><span>Paid in total · ${payments.length} payments</span></div></div>
<h2>Fees</h2>${table(
      ['Fee', 'Period', 'Year', 'Expected', 'Paid', 'Balance', ''],
      obligations.map((o) => [esc(o.income_name), esc(o.period_name), esc(o.academic_year_name), money(o.expected_cents), money(o.paid_cents), money(o.balance_cents), statusPill(o.status)]),
      [3, 4, 5]
    )}
<h2>Payments</h2>${paymentsTable(payments, env, q, false)}`;
    return html(`${learner.first_name} ${learner.last_name}`, 'learners', body);
  }

  if (path === '/payments') {
    const today = localDate(new Date(), env);
    const from = validDay(url.searchParams.get('from')) ?? addDays(today, -6);
    const to = validDay(url.searchParams.get('to')) ?? today;
    const rows = await all(
      db,
      'SELECT * FROM v_payment_lines WHERE school_id = ? AND paid_at >= ? AND paid_at < ? ORDER BY paid_at DESC, payment_id DESC',
      sid, dayStartUtc(from, env), dayStartUtc(addDays(to, 1), env)
    );
    const total = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
    const byMethod = new Map<string, number>();
    for (const r of rows) byMethod.set(String(r.method_name ?? 'Unknown'), (byMethod.get(String(r.method_name ?? 'Unknown')) ?? 0) + Number(r.amount_cents));
    const body = `<h1>Payments</h1><p class="sub">${rows.length} payments, ${money(total)} from ${when(`${from}T12:00:00Z`, env, false)} to ${when(`${to}T12:00:00Z`, env, false)}.</p>
<form class="filters" method="get"><input type="hidden" name="school" value="${esc(sid)}"><input type="date" name="from" value="${from}"><input type="date" name="to" value="${to}"><button>Show</button></form>
<div class="stats">${[...byMethod].map(([m, c]) => `<div class="stat"><b>${money(c)}</b><span>${esc(m)}</span></div>`).join('')}</div>
<h2>All payments</h2>${paymentsTable(rows, env, q)}`;
    return html('Payments', 'payments', body);
  }

  if (path === '/expenses') {
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') ?? '') ? url.searchParams.get('month')! : localDate(new Date(), env).slice(0, 7);
    const [rows, byCategory] = await Promise.all([
      all(
        db,
        `SELECT x.*, ec.expense_name, TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS recorded_by
         FROM expenses x JOIN expense_categories ec ON ec.expense_category_id = x.expense_category_id
         LEFT JOIN employees e ON e.employee_id = x.recorded_by_employee_id
         WHERE x.school_id = ? AND substr(x.expense_date, 1, 7) = ? ORDER BY x.expense_date DESC, x.expense_id DESC`,
        sid, month
      ),
      all(db, 'SELECT expense_name, expenses, total_cents FROM v_expense_totals WHERE school_id = ? AND month = ? ORDER BY total_cents DESC', sid, month),
    ]);
    const total = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
    const body = `<h1>Expenses</h1><p class="sub">${money(total)} spent in ${esc(month)}.</p>
<form class="filters" method="get"><input type="hidden" name="school" value="${esc(sid)}"><input type="month" name="month" value="${esc(month)}"><button>Show</button></form>
<h2>By category</h2>${table(['Category', 'Expenses', 'Total'], byCategory.map((c) => [esc(c.expense_name), String(c.expenses), money(c.total_cents)]), [1, 2])}
<h2>All expenses</h2>${table(
      ['Date', 'Category', 'Description', 'Recorded by', 'Amount'],
      rows.map((r) => [when(`${r.expense_date}T12:00:00Z`, env, false), esc(r.expense_name), esc(r.description ?? ''), esc(r.recorded_by || '—'), money(r.amount_cents)]),
      [4]
    )}`;
    return html('Expenses', 'expenses', body);
  }

  if (path === '/staff') {
    const [staff, runs] = await Promise.all([
      all(
        db,
        `SELECT e.*, r.role_name, r.access_level FROM employees e JOIN roles r ON r.role_id = e.role_id
         WHERE e.school_id = ? AND e.deleted_at IS NULL ORDER BY e.last_name, e.first_name`,
        sid
      ),
      all(
        db,
        `SELECT pr.*, count(pl.payroll_line_id) AS people,
                coalesce(sum(pl.basic_salary_cents + pl.transport_allowance_cents + pl.housing_allowance_cents - pl.paye_deduction_cents - pl.pension_deduction_cents), 0) AS net_cents
         FROM payroll_runs pr LEFT JOIN payroll_lines pl ON pl.payroll_run_id = pr.payroll_run_id
         WHERE pr.school_id = ? GROUP BY pr.payroll_run_id ORDER BY pr.period_year DESC, pr.period_month DESC`,
        sid
      ),
    ]);
    const net = (e: Row) =>
      e.basic_salary_cents == null
        ? '—'
        : money(Number(e.basic_salary_cents) + Number(e.transport_allowance_cents) + Number(e.housing_allowance_cents) - Number(e.paye_deduction_cents) - Number(e.pension_deduction_cents));
    const body = `<h1>Staff</h1><p class="sub">${staff.length} staff accounts.</p>
${table(
      ['Name', 'Role', 'Email', 'Basic salary', 'Net pay', 'Last signed in'],
      staff.map((e) => [`${esc(e.first_name)} ${esc(e.last_name)}`, `${esc(e.role_name)}${e.access_level === 'ADMIN' ? ' <span class="pill ok">Admin</span>' : ''}`, esc(e.email), e.basic_salary_cents == null ? '—' : money(e.basic_salary_cents), net(e), when(e.last_login_at, env)]),
      [3, 4]
    )}
<h2>Payroll runs</h2>${table(
      ['Month', 'People', 'Net pay', 'Generated by', 'When'],
      runs.map((r) => [
        esc(new Date(Date.UTC(Number(r.period_year), Number(r.period_month) - 1, 15)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })),
        String(r.people),
        money(r.net_cents),
        esc(r.generated_by_label),
        when(r.generated_at, env),
      ]),
      [1, 2]
    )}`;
    return html('Staff', 'staff', body);
  }

  return html('Not found', '', '<h1>Page not found</h1>', 404);
}

function paymentsTable(rows: Row[], env: SiteEnv, q: string, withLearner = true) {
  return table(
    [...(withLearner ? ['Learner'] : []), 'When', 'Fee', 'Period', 'Method', 'Recorded by', 'Amount'],
    rows.map((r) => [
      ...(withLearner ? [`<a href="/learners/${encodeURIComponent(String(r.learner_id))}?${q}">${esc(r.first_name)} ${esc(r.last_name)}</a>`] : []),
      when(r.paid_at, env),
      esc(r.income_name),
      `${esc(r.period_name)} ${esc(r.academic_year_name)}`,
      esc(r.method_name ?? '—'),
      esc(r.recorded_by || '—'),
      money(r.amount_cents),
    ]),
    [withLearner ? 6 : 5]
  );
}
