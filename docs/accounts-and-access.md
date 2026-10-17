# Accounts and access

How signing in works, who can do what, and how to get back in if you lock yourself out.

## The two access levels

Every account holds one **role**, and every role carries an **access level** — either `ADMIN` or `CASHIER`. A school can name its roles whatever it likes ("Bursar", "Front Desk", "Head"); the access level is what the app actually enforces.

| | Administrator | Cashier |
|---|---|---|
| Overview dashboard | yes | no |
| School setup (fees, periods, staff) | yes | no |
| Add a learner | yes | yes |
| Edit or archive a learner | yes | no |
| Record a payment | yes | yes |
| Delete a payment | yes | no |
| Owing | yes | yes |
| Unpaid Mandatory | yes | yes |
| Expenses | yes | yes |
| Reports and PDF exports | yes | no |
| Manage users and roles | yes | no |
| Switch between schools | yes | no |

A cashier can still *read* the reference data behind those screens — fee categories, payment periods, methods, classes, academic years — because the Record Payment and Add Learner forms cannot work without it. They just cannot change any of it.

Administrators land on the Overview dashboard; cashiers land on Payments.

The permission list lives in one file, `lib/auth/permissions.ts`, and is used by the sidebar, the page guards and the API guards alike, so the three can never disagree.

## First run

The app ships with **no default account and no default password**. Nothing in the code or the database grants access until you create the first administrator yourself.

On first launch, every page redirects to `/setup`, which asks for your name, which school you belong to, and a password you choose. It then signs you in. That screen works exactly once — once an administrator exists, `/setup` says so and the endpoint behind it refuses, so it cannot be used to mint a second administrator later.

If the database has no schools yet, `/setup` creates the school at the same time.

## Adding staff

Administrators add staff in **School setup → Employees**. The app generates the login email (`jdoe@ssv.school` — first initial, surname, and the school id as the domain) and a one-time password, shown once on screen. Copy it and hand it over; it is not stored anywhere in readable form and cannot be shown again.

Those addresses are **not real email addresses**. Nothing is ever sent to them — they are just usernames. That is also why there is no "forgot my password" email: password resets are done by an administrator, in person.

New staff are asked to choose their own password the first time they sign in, and cannot use the rest of the app until they do.

## Resetting a forgotten password

An administrator resets it in **School setup → Employees**, with the key icon on that person's row. This:

- issues a new one-time password, shown once on screen — hand it over in person;
- signs the person out everywhere, so nothing signed in with the old password keeps working;
- clears any lockout from wrong passwords;
- requires them to choose their own password again when they next sign in;
- records who reset whose password in the audit log (never the password itself).

The key icon is not shown on your own row: change your own password from the user menu with **Change password**, which asks for the current one. If the only administrator has forgotten their password, use the break-glass steps below.

## Sessions

- A session lasts **4 hours of inactivity**, sliding forward each time you use the app, up to a hard limit of **12 hours** from signing in. Then you sign in again.
- Signing out ends it immediately.
- Changing your password ends every other session for your account.
- Five wrong passwords in a row locks the account for **15 minutes**. It unlocks on its own; an administrator can clear it sooner by resetting the password.

Everything runs against the local database. There is no internet connection involved at any point, no cloud login, and nothing leaves the machine.

## Who did what

Payments record the member of staff who took them, and that name appears on the payments list and on the printed receipt. A separate audit log records sign-ins, failed sign-ins, password changes, account changes and deletions — including deletions, which is the case a column on the row itself cannot cover.

Deleting a member of staff never deletes the payments they recorded. Their name stays on the audit entries even after the account is gone.

## Break-glass: getting back in

Run these against the application database with `psql` (or any SQL client) **only if you are genuinely locked out**. They are deliberately not exposed anywhere in the app.

**See which accounts exist and what level they hold:**

```sql
SELECT e.employee_id, e.email, e.first_name, e.last_name,
       r.role_name, r.access_level, e.deleted_at, e.locked_until
FROM employees e
JOIN roles r ON r.role_id = e.role_id
ORDER BY e.school_id, e.email;
```

**Clear a lockout:**

```sql
UPDATE employees
SET locked_until = NULL, failed_login_count = 0
WHERE email = 'jdoe@ssv.school';
```

**Promote an existing account to administrator** (for example, if the only administrator left the school):

```sql
UPDATE roles SET access_level = 'ADMIN'
WHERE role_id = (SELECT role_id FROM employees WHERE email = 'jdoe@ssv.school');
```

**Force someone to set a new password at next sign-in** — note this does *not* set a password, it only requires a change, so pair it with an administrator issuing a new temporary one:

```sql
UPDATE employees SET must_change_password = TRUE WHERE email = 'jdoe@ssv.school';
```

**Start over completely.** Removing every administrator makes `/setup` available again, so you can create a fresh one with a password you choose. This does not touch learners, payments or any other data:

```sql
-- Sessions go with the accounts; audit history is kept, with the names intact.
DELETE FROM employees
WHERE role_id IN (SELECT role_id FROM roles WHERE access_level = 'ADMIN');
```

After any of these, reload the app.

## Where the connection details are

The desktop app stores them in `config.json` under its user-data folder, with the database password encrypted by Windows. See [desktop.md](desktop.md) for the location and for how the embedded database is managed.
