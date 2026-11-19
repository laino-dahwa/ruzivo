# Expected fees and Balances

This doc explains how the **Expected fees** page (`/expected-fees`) works and how it relates to **Balances** (`/owing`). It is for anyone changing either page who needs the reasoning as well as the SQL.

## The rule

**Balances is the single source of truth for what a learner owes.** Expected fees are suggestions: the system works out what each learner *should* be paying, and a person confirms it before it counts.

| | Expected fees | Balances |
|---|---|---|
| What it is | Fees the system suggests, waiting for a decision | Fees that are owed |
| Counts as owed? | No | Yes |
| Where it is counted | Only on the Expected fees page | Balances, statements, the Record Payment form, reports, the overview and the cloud website |

Expected fees replaced two earlier pages. "Expected fees" was a table of every learner's obligations, and "Learner owings" showed the same data as one card per learner. The combined page uses the cards and the table's filters. Both old addresses redirect to it.

## Where a suggestion comes from

`repositories/expected-fees/pendingFeesQuery.ts` works this out. The rules are the same ones the old obligations engine used:

- **Mandatory fees** are suggested for every enrolled learner and every period the fee applies to.
  - The fee's "Applies to" setting still limits this: all learners, specific classes or specific learners.
  - So does its period setting: all periods or selected ones.
- **Optional fees** are suggested only after the learner has taken the fee up. Once a month of it is accepted (paying it accepts it), every later month it applies to is suggested.
  - Only month-named periods ("January", "February", …) take part, because only they have an order.
- **Once-off fees** are never suggested. They are paid when they are paid.
- **Fees with no limit** are never suggested, because there is no amount to owe.

A suggestion is only shown while it is **pending**. It disappears from the pending list when any of these happens:

- it is accepted, or denied for its period;
- a payment is recorded against it;
- the learner is exempt from the fee (denied forever);
- its period hasn't started yet.

A month-named period starts on the 1st of that month within its academic year. For a year running September to August, "January" means January of the second calendar year. Periods with other names, such as "Term 2", have no dates, so they are always treated as started. If one shouldn't apply yet, deny it for that period.

Enrolments have no joining date. A learner who joins in June still gets suggestions for January to May; deny those for their periods.

## Decisions

Decisions are stored in two tables, both created by migration `015_fee_decisions`:

- **`fee_decisions`**: one row per learner, fee, period and academic year, marked either:
  - **`ACCEPTED`**: the fee is owed, and it appears on Balances. Its `amount` is fixed when it's accepted, so a later change to the fee's limit in School Setup never rewrites an existing balance. Payments are limited by that fixed amount too.
  - **`SKIPPED`**: denied for this period only. The fee is suggested again for the next period.
- **`fee_exemptions`**: denied forever. The learner is never suggested this fee again, in any period or year. Every pending period of it disappears at once. A reason is required. Fees already accepted or paid are not affected.

Each decision can be undone from the page's **Show** filter:

| State | Undo | Allowed when |
|---|---|---|
| Accepted | **Withdraw** (back to pending) | Nothing has been paid toward it. Once something has, the payment must be deleted first. |
| Denied for one period | **Bring back** | Always |
| Denied forever | **Restore** (suggested again) | Always |

Admins and cashiers can both make decisions (capability `obligation.decide`). Every decision is written to the audit log (`expected_fee.*`).

Accepting and denying only touch fees that are still pending when the request runs. Anything someone else accepted, paid or denied in the meantime is left alone. The page reports it as "already dealt with" rather than failing the whole batch.

## Payments

- **Recording a payment accepts the fee it pays for**, at the fee's current limit. If the fee was denied for that period, it's accepted after all. These acceptances have `source = 'PAYMENT'`.
- **Deleting a fee's last payment removes an acceptance that only the payment made.** Otherwise deleting a mistaken payment would leave the learner owing the whole fee. A fee someone accepted on purpose stays accepted, and owing.
- The Record Payment limit check uses the accepted amount when there is one, and the fee's current limit otherwise.

## Upgrading

Migration 015 accepts every learner, fee and period that already has a payment, at the fee's current limit. That is exactly what Balances showed for it before, so no balance changes on upgrade. Unpaid mandatory fees from earlier in the year, which were never on Balances, now appear as pending. **Accept all shown** works through that backlog for the current filters, after confirming how many fees there are and their total.

The cloud website needs updating **before** desktop computers upgrade:

1. Apply `cloud/d1/migrations/0003_fee_decisions.sql` (`npm run db:migrate` in `cloud/`).
2. Deploy the Worker.

Until then the Worker refuses data from database version 015. The desktop keeps those changes queued and retries.

## What it does not do

- **It doesn't remind anyone.** Someone has to open the page.
- **It doesn't carry balances between academic years.** Each year's fees are suggested and owed in that year.
- **It doesn't order non-month periods.** Optional fees only carry forward through month-named periods, and other periods are never held back as "not started yet".
