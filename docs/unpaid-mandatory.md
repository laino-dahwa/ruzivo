# Unpaid Mandatory Payments — how it works, why it exists, and where it stops

This is a plain-language explanation of the **Unpaid Mandatory Payments** page (`/unpaid-mandatory`) and the "obligations" engine behind it (`repositories/payment/read/obligationsQuery.ts`, `getObligations.ts`). It is written for anyone picking this up later — a future contributor, or future-you — who needs the reasoning, not just the SQL.

## Why it exists

Before this page existed, the app could only tell you about a fee if a **charge** had already been created for it. A charge only gets created the moment someone records a payment. That meant a learner who owed school fees but had **never paid a cent** was invisible everywhere in the system — not on the Owing page, not anywhere. The books only showed people who had already started paying, which is close to useless for the exact learners a bursar most needs to chase.

Unpaid Mandatory Payments exists to close that specific gap: it shows every learner who **should** owe a mandatory fee, whether or not any payment record exists yet.

## What "mandatory" and "optional" mean here

Every income category (fee) in School Setup now carries a `priority`:

- **Mandatory** — every learner it applies to is assumed to owe it, automatically, for every applicable period. No payment needs to happen first for the obligation to exist.
- **Optional** — the opposite default. A learner is only considered "in" for an optional fee once they've actually paid toward it at least once. Nobody is assumed to owe an optional fee just by existing.
- **Once-off** — never owed just by existing, and not set up for any particular period: it can be paid in any month, or never, and that's fine either way. In the month it is paid, its limit applies to that month: 5 of 20 paid in January appears here as 15 outstanding for January. Paying it in June as well starts June's own limit. Unlike optional fees it is never projected into later months. With no limit set it can be paid once per month and never appears here.

A fee can also be scoped narrower than "every learner, every period":

- **Class/learner applicability** — a fee can apply to all learners, to specific classes, or to specific named learners.
- **Period applicability** — a fee can apply to all payment periods, or to a specific hand-picked set of periods.

These are configured on the Income Categories card in School Setup, and the obligations engine respects them exactly — a fee scoped to "Grade 4 only" or "Term 2 only" will never generate an obligation for a learner or period outside that scope.

## What the page actually shows

For every learner currently enrolled, the engine works out which fees they should owe and stitches together whatever has actually been paid against each one, all in a single query with three parts unioned together:

1. **Mandatory fees** — one row per learner × applicable mandatory fee × applicable period, whether or not a charge has ever been created. If nothing has been paid, it still shows up with `Paid = 0` and status `No Payment`.
2. **Optional fees, as already paid** — same as the rest of the app already did: an optional fee only appears once a charge exists for it (proof the learner engaged with it).
3. **Optional fees, projected forward** — the one genuinely new idea beyond "just show mandatory fees with zero payments." If a learner has paid an optional fee in one period (say, Swimming in September) and then simply stops, the engine assumes that fee is still expected every later applicable period until either a payment resumes or the fee's applicable periods run out. So a learner who paid Swimming once in September and never again shows up owing it for October, November, December, and so on — not just the next month, and not forever silently dropped after the first missed period.

Each row ends up with a status:

- **No Payment** — nothing has been paid toward it at all.
- **Partially Paid** — something has been paid, but less than the fee's configured limit.
- **Fully Paid** — paid in full.

The page defaults to showing **Mandatory + No Payment** — the specific list a bursar opens this page to see — but every filter (class, learner, fee, priority, status, academic year, period) can be changed and combined.

## Deliberately not shared with the Owing page

The existing Owing page (`/owing`) and the Record Payment form both still work exactly as before: they only ever reflect **real charges that already exist**. That was a conscious choice, made after review, not an oversight — mixing "assumed obligations" into a page whose whole job is to reflect actual transaction history would make it lie about what's actually been charged. Unpaid Mandatory Payments is a separate, purpose-built view for a separate question ("who *should* be paying that isn't"), rather than a change to what "owing" means everywhere else in the app.

## What it does not do

Being explicit about the edges matters as much as the feature itself:

- **It does not create anything.** No charge, payment, or database row is written by viewing this page. It's a read-only projection — nothing here affects a learner's real balance until an actual payment is recorded through the normal payment flow.
- **It does not chase optional fees a learner has never touched.** An optional fee with zero payment history never appears here, by design — "optional" means genuinely optional until the learner opts in with a first payment.
- **It does not project mandatory fees the same way it projects optional ones.** Mandatory fees are simply *always* in scope for every applicable period — there's no "chain" logic needed, since there's no engagement to detect.
- **It only recognises period-based recurrence for periods literally named after calendar months** ("January", "February", …), matched case-insensitively. A school using "Term 1" / "Term 2" style period names gets no forward projection for optional fees — this mirrors an existing convention already used elsewhere in the payment form (the "default to this month" behaviour), rather than inventing a new one, but it is a real limitation worth knowing about.
- **It excludes fees with no configured limit.** If a mandatory or optional fee has no `income_limit` set, there's no real number to call "expected," so it's left out of this page entirely rather than shown with a blank/undefined balance.
- **It does not know about archived (soft-deleted) learners.** Deleted learners are excluded everywhere the obligations engine touches, same as every other page in the app.
- **It is not a notification or reminder system.** Nothing gets emailed, texted, or flagged automatically — someone has to open the page and look.

## Future work and possible improvements

Nothing below is committed to — these are the natural next steps if this page needs to grow:

- **Configurable recurrence naming.** Right now, forward-projection for optional fees only works for month-named periods. Schools using term-based or custom-named periods get no recurrence at all. A school-level setting for "these N periods are sequential, in this order" would let recurrence work regardless of naming convention.
- **Reminders/notifications.** Turning this from a page someone has to remember to check into something that proactively surfaces — a dashboard badge, a scheduled export, or an actual email/SMS reminder to a parent — is the most obvious next step, and was explicitly out of scope for this iteration.
- **Historical obligations across academic years.** The engine currently reasons within one academic year's enrolment. Carrying an unpaid mandatory balance forward into the next academic year as a visible "prior year balance owing" is not currently handled.
- **Bulk actions from this page.** Right now this is read-only by design. A natural follow-up would be letting a bursar select rows here and jump straight into recording a payment for them, rather than switching pages and re-searching for the learner.
- **Per-learner exemptions.** There's currently no way to mark one specific learner as exempt from an otherwise-mandatory fee without reconfiguring the fee's applicability entirely (e.g. moving it to `SPECIFIC_LEARNERS` and re-listing everyone else). A dedicated exemption list would be more direct for the "one scholarship kid doesn't pay this fee" case.
- **Performance at scale.** The mandatory branch is a cross join of learners × applicable fees × applicable periods, filtered down afterwards. This is fine at the school sizes tested so far, but a school with a very large roll and many fee/period combinations would be the first place to look if this page ever feels slow.
