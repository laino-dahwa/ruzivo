# Ruzivo cloud website

A read-only copy of a school's Ruzivo data on Cloudflare, kept up to date by the desktop app.

```
Desktop app (Postgres) ──signed batches──▶ Worker /sync/* ──▶ D1 (rows) + R2 (logos)
                                                                   │
                         Staff (via Cloudflare Access) ◀── Worker website (read-only)
```

- **Desktop side:** `electron/sync/`. Postgres migration `014_sync_outbox` records every changed row. Every 5 minutes, after each backup, and on **Sync now**, the app sends changes to the Worker.
- **Format and conversion:** `electron/sync/normalize.ts`, shared by the desktop app, the Worker and the backup importer.
  - Money is stored as integer cents (`amount_cents`).
  - Timestamps are UTC ISO text.
  - `school_id` has no padding.
  - Logos are stored in R2.
  - `password_hash` and `security_key_hash` are never sent.
- **D1 schema:** `d1/migrations/0001_initial.sql`, the same tables as Postgres. It includes views the website uses:
  - `v_obligations` is a direct port of the desktop app's amounts-owing query, so the website matches the app to the cent.
  - `v_learner_balances`, `v_payment_lines`, `v_daily_takings` and `v_expense_totals`.
- **Only one computer may write to a database.** Each school computer has its own ids, so linking a second computer stops the first one.

## Set up (once)

You need a Cloudflare account and Node 22+. In this folder:

```sh
npm install
npx wrangler login

npx wrangler d1 create ruzivo              # copy the database_id it prints into wrangler.jsonc
npx wrangler r2 bucket create ruzivo-logos
npm run db:migrate                         # creates the tables in D1

npx wrangler secret put LINK_CODE          # a long random phrase, 12+ characters; admins type it to link a computer
npm run deploy                             # prints the address, e.g. https://ruzivo-cloud.<you>.workers.dev
```

### Protect the website with Cloudflare Access (required)

The website shows learners' details and staff salaries. **It refuses every page until Access is set up.** It checks the Access token's signature itself, so a misconfigured route can't expose data.

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
   - Domain: the Worker's address.
   - Policy: **Allow**, with the email addresses of the people who may view it.
2. Add a second self-hosted application for the same domain with path **`sync`**, using a **Bypass** policy for **Everyone**. The desktop app can't sign in to Access; it signs every request with its own key instead.
3. Copy two values into `vars` in `wrangler.jsonc`, then run `npm run deploy` again:
   - From the first application's **Overview**, the **Application Audience (AUD) Tag** → `ACCESS_AUD`.
   - Your team domain (`<team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN`.

Optionally, set `TIMEZONE` in `wrangler.jsonc` if the school is not in `Africa/Harare`.

### Link the school computer

In the desktop app, an administrator goes to **Setup → Cloud website → Link to the website…** and enters:
- the Worker address,
- the link code,
- their own password.

The app then sends a full copy, and after that only changes. If the computer is offline, changes wait and go when it's back online.

## Optional: load a backup before the desktop app is linked

To see the website with real data before the desktop update is installed, run this from the repository root:

```sh
node scripts/backup-to-d1.mjs "C:\path\to\Ruzivo backup 2026-10-27 0941"
npx wrangler d1 execute ruzivo --remote --file=d1-import/import.sql --config cloud/wrangler.jsonc
# then the logo uploads listed in d1-import/r2-upload.txt (replace <bucket> with ruzivo-logos)
```

The script checks every file's fingerprint against the backup's `manifest.json`, exactly as a restore would. `d1-import/` holds personal data and is git-ignored, so delete it when you're done. When the computer is linked later, its first full sync replaces this data.

## Run it locally

```sh
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                                  # http://localhost:8787
```

- `wrangler dev` needs the `workerd` runtime. If npm reports that it held back workerd's install script, run `npm install-scripts approve workerd`, then `npm install` again.
- `.dev.vars` lets `localhost` skip Access. That only works on localhost.

The whole sync path is also tested without Cloudflare. `__tests__/sync.test.ts` runs the real Worker code against `node:sqlite`, using the D1 schema:

```sh
npm test -- __tests__/sync.test.ts                                   # from the repository root
# against a real backup as well:
RUZIVO_SYNC_TEST_BACKUP="C:\path\to\backup" npm test -- __tests__/sync.test.ts
```

## Changing the schema later

A Postgres migration that adds or changes a mirrored column needs a matching change here:

1. Add a new `d1/migrations/000N_*.sql`.
2. If the column needs converting (money, timestamps, booleans), update `electron/sync/normalize.ts`.
3. Add the new Postgres migration's name to `SUPPORTED_MIGRATIONS` in `src/sync.ts`.
4. Deploy the Worker **before** releasing the desktop app.

Until the Worker is updated, a newer desktop app gets a clear "the website needs updating" error, and its changes stay queued on the computer. Nothing is lost.

## Limits

D1's free plan allows 100,000 rows written per day. Indexes count towards that.
- A full sync writes every row plus its index entries. For the current backup (about 6,000 rows), that's a few tens of thousands.
- Everyday changes are tiny.

Full syncs only happen when a computer is linked and after a restore. If you restore often, or the school grows a lot, Workers Paid ($5/month) raises the limit to 50 million.
