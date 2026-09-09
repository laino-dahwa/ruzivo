# Bulk operations and PDF export

## Bulk creates

Learners, payments, and expenses can all be created many-at-once. Every create endpoint accepts **either** a single object **or** an array of them:

```jsonc
// both are valid
{ "first_name": "John", "last_name": "Doe", ... }

[
  { "first_name": "John", "last_name": "Doe", ... },
  { "first_name": "Jane", "last_name": "Smith", ... }
]
```

`normalizeToArray` (`lib/validation/bulk.ts`) collapses the first form into the second, so everything downstream — validation, repositories, SQL — only ever deals with an array. Single-record callers that predate bulk support keep working unchanged.

| Endpoint | Repository | How the batch is written |
|---|---|---|
| `POST /api/learners` | `createLearners` | One multi-row `INSERT` for learners + one for enrolments, inside a `transaction()` |
| `POST /api/learners/payments` | `createChargesWithPayments` | Charge + payment + allocation per line, all inside one `transaction()` |
| `POST /api/schools/[school_id]/expenses` | `createExpense` | A single multi-row `INSERT` |

A batch of 200 learners is one HTTP request and one transaction — not 200 of either.

### Payments: two dimensions at once

A payment record already carried an `income_categories` array, so payments bulk in **two** directions and both are supported together in a single request:

- **Several payments for the same learner** — several entries in that learner's `income_categories` array (e.g. tuition, transport, and uniform in one go). The learner, payment period, and method are shared; each line becomes its own charge + payment + allocation.
- **Several payments for different learners** — several objects in the top-level array.

```jsonc
[
  {                                    // Tendai: three fees at once
    "learner_id": "UITLGFG2", "enrolment_id": 1,
    "payment_period_id": 1, "academic_year_id": 1, "payment_method_id": 1,
    "income_categories": [
      { "income_category_id": 2, "amount": 100 },
      { "income_category_id": 1, "amount": 50 },
      { "income_category_id": 3, "amount": 25 }
    ]
  },
  {                                    // Rudo: one fee
    "learner_id": "UITIW138", "enrolment_id": 2,
    "payment_period_id": 1, "academic_year_id": 1, "payment_method_id": 1,
    "income_categories": [{ "income_category_id": 2, "amount": 200 }]
  }
]
```

That request writes **four** payment records in one transaction. In the UI this is a block per learner ("Another payment for this learner" adds a line; "Add another learner" adds a block), and the submit button counts the total across both dimensions — `Record 4 payments`.

When a learner has more than one line, validation names the offending one: `"Payment line 2: Amount must be greater than zero"`.

## Error strategy: all-or-nothing

**A batch is rejected in full if any record in it is invalid.** Nothing is silently dropped, and there is no partial write.

This is deliberate. The data is financial: a payment is three linked rows (`charges`, `payments`, `payment_allocations`) and every balance, report total, and dashboard figure in the app is *derived* from them at read time. A partially-applied batch would mean money recorded against no charge, or a charge with no payment — silently wrong totals rather than a visible error. The repositories were already transactional for exactly this reason, so all-or-nothing also preserves their efficient single-statement inserts instead of degrading to per-row loops.

Validation runs over the whole batch before anything is written, and reports every problem it finds, keyed to the record's position in the submitted array:

```jsonc
// 400
{
  "error": "Expense 2: Amount must be greater than zero",
  "details": [
    { "index": 1, "field": "amount", "message": "Amount must be greater than zero" }
  ]
}
```

The `error` key is kept because `services/http.ts` surfaces it as the thrown message — existing client error handling needed no changes. `details` is additive.

Validation (`lib/validation/entities.ts`) deliberately mirrors what the database already enforces (`amount > 0`, required foreign keys, real dates) so those failures arrive as clear per-record messages instead of raw constraint violations. Referential checks (does this `expense_category_id` exist?) are still left to the database's foreign keys — validation checks shape, the DB checks existence.

### Duplicates

Learners have **no** uniqueness constraint on name or date of birth, and this is intentional — real schools have learners with the same name. The only relevant constraint is `uq_learner_year (learner_id, academic_year_id)` on `enrolments`, which stops the same learner being enrolled twice in one academic year. Bulk creation does not add any duplicate-blocking beyond that.

## Bulk entry UI

Each of the three forms is a list of rows rather than a single record:

- The form opens as one row and looks exactly as it did before.
- **Add another** appends a row; from two rows up, each row gets a numbered label (`Learner 1`, `Expense 2`…) and a remove button. On Payments, each learner block also has **Another payment for this learner** for additional fee lines.
- The submit button pluralises (`Add learner` → `Add 3 learners`) and is disabled while the request is in flight.
- On success the form resets to one empty row and a toast reports the count. **On failure the rows are kept**, so the user can correct the problem instead of retyping the batch.

## PDF export

Every table in the app exports through the same generator the Reports section has always used, `lib/pdf/generateReportPdf.ts` — one implementation, one look, multi-page with column headers repeated per page and `Page N of M` footers.

| Page | Endpoint | Filename |
|---|---|---|
| Learners | `GET /api/learners?format=pdf` | `learners-<date>.pdf` |
| Payments | `GET /api/learners/payments?format=pdf` | `payments-<date>.pdf` |
| Owing | `GET /api/learners/balances?format=pdf` | `outstanding-balances-<date>.pdf` |
| Expenses | `GET /api/schools/[id]/expenses?format=pdf` | `expenses-<date>.pdf` |
| Reports | `GET /api/schools/[id]/reports/[type]?format=pdf` | `<type>-report-<date>.pdf` |

Two small pieces were added rather than duplicating anything:

- `lib/pdf/tablePdfResponse.ts` — wraps the generator with the app name, generation date, and download headers, so a route only supplies columns and rows.
- `services/pdf.ts#downloadPdfFrom` — the client half, including the single branch where Electron hands the bytes to a native "Save As" dialog instead of a browser download. The Reports page now uses this too.

`totalLabel`/`totalValue`, `dateLabel`, and `schoolName` are optional on the generator: a learner list has no monetary total (it prints a record count instead) and is not scoped to a reporting period.

**Exports follow the filters on screen.** Each endpoint's PDF branch runs after the same filter parsing the JSON response uses, so a filtered Payments table exports exactly the filtered rows — matching how Reports has always behaved.

### Known gap

`getLearners`, `getPayments`, and `getBalances` have no `school_id` filter, so the Learners, Payments, and Owing pages — and therefore their PDF exports — show data across **all** schools, not just the active one. This predates bulk/PDF work and was left as-is deliberately; those three PDFs consequently print no school name in the header, because it would misrepresent the contents. Expenses and Reports are correctly school-scoped and do show it.

## Fee limits (per learner, per fee, per period)

`income_categories.income_limit` is the amount owed for **one fee, by one learner, in one payment period of one academic year**. That is the unit `getBalances` has always used for "charged vs paid", and it is the unit enforcement uses, so the limit being enforced is the same number the Owing page shows.

Before writing anything, `createChargesWithPayments` checks each payment line against what the learner has already paid for that exact key:

```
remaining = income_limit − (already paid) − (earlier lines in this same request)
reject if remaining <= 0, or if the line's amount > remaining
```

Both checks run **inside the same transaction as the inserts**, so the balance a payment is validated against cannot change before it is written. Concurrent payments for the same learner+fee+period are serialised with `pg_advisory_xact_lock` keyed on that tuple — two simultaneous requests can't both read the same "remaining" and both succeed. Unrelated payments are never blocked, and the lock releases on commit or rollback.

A fee with `income_limit` NULL has no configured limit and is not restricted.

Rejections come back as `400` in the same shape as other validation failures:

```jsonc
{
  "error": "Payment exceeds the remaining Tuition balance for January. The learner has $40.00 remaining to pay.",
  "details": [{ "index": 0, "field": "amount", "message": "…" }]
}
```

Bulk requests accumulate across lines, so several payments that each pass individually but breach the limit together are rejected as a batch — nothing is written.

The payment form shows `Limit … · Paid … · Max …` under each amount and sets the input's `max` to the remaining amount, counting earlier lines in the same form. That is convenience only; the server is the authority.

### Why reports were regrouped

Every payment creates its own `charges` row. `getOwingReport` and `getReportSummary` grouped by `charge_id`, which counted the same fee once per instalment — a $100 fee settled as $60 + $40 reported **$100 still outstanding** while the Owing page correctly reported $0. Both now group by learner + income category + period + academic year, matching `getBalances`, so every screen agrees on one number.
