# NLC Edge Functions

The app uses church Logto login, not Supabase Auth, in production.

Current flow:

1. Frontend completes Logto PKCE login.
2. Frontend calls `nlc-session` with the Logto access token.
3. `nlc-session` verifies Logto userinfo and upserts `profiles` / `user_identities` with the service role.
4. Frontend uses a small client shim that calls `nlc-data` for database reads/writes.
5. `nlc-data` verifies the Logto access token on each request, resolves the current profile, and applies server-side table/action restrictions before using the Supabase service role.

Required Supabase Edge Function secrets:

```bash
NLC_LOGTO_ISSUER=https://sso.newlife.org.tw/oidc
NLC_MEMBER_HUB_URL=https://member.newlife.org.tw
NLC_PLATFORM_API_URL=https://platform.newlife.org.tw/platform/v1
APP_ORIGIN=https://bible.newlife.org.tw
```

Supabase provides these default secrets automatically:

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

`NLC_SUPABASE_JWT_SECRET` is no longer required. The app no longer signs custom Supabase JWTs.

Both functions must have `verify_jwt = false` because the incoming bearer token is a Logto token, not a Supabase token.

## issue-report-sheet-sync

Mirrors every new `public.issue_reports` row to an engineering-team Google
Sheet, exposing only `created_at` / `category` / `status` / `description` —
no `user_id`, `url`, `user_agent`, `metadata`, or report `id` ever leaves the
app. Fires once per new report; editing a report's status later in the admin
panel does **not** update the sheet row (by design — see the code comment in
`index.ts` if that ever needs to change).

This function also has `verify_jwt = false` — its caller carries no
Supabase/Logto token to verify at all. It's protected instead by a shared
secret checked against a custom header.

**The trigger is a SQL migration, not a Dashboard Database Webhook.** The
Dashboard's Database → Triggers UI only lets a trigger call a Postgres
function (no external URL field), and `/database/hooks` (the dedicated
Database Webhooks page on older Supabase Dashboard versions) 404s on this
project. So `supabase/migrations/0077_issue_report_sheet_sync_trigger.sql`
reproduces the same thing directly in Postgres with the `pg_net` extension:
an `AFTER INSERT` trigger on `issue_reports` that POSTs to this Edge
Function, built from the exact payload shape (`type`/`table`/`record`) a
Database Webhook would have sent — so `index.ts` didn't need to change when
the delivery mechanism did.

Required Supabase Edge Function secrets (in addition to the defaults above):

```bash
ISSUE_REPORT_WEBHOOK_SECRET=<random string you choose>        # checked against the pg_net trigger's x-webhook-secret header
ISSUE_REPORT_SHEET_WEBHOOK_URL=<Apps Script Web App /exec URL> # from step 3 below
ISSUE_REPORT_SHEET_WEBHOOK_SECRET=<random string you choose>   # checked by the Apps Script doPost, see apps-script.gs.txt
```

`ISSUE_REPORT_WEBHOOK_SECRET` must ALSO be stored in Supabase Vault under
the same value, so the SQL trigger function can read it at runtime (a
migration file is committed to git, so the actual secret value can never
live inside one) — see step 5 below.

### One-time setup (all done in your own Google/Supabase accounts — nothing here can be automated from this repo)

1. Pick two random secret strings (they can be the same value or different —
   just don't reuse a real password). One becomes
   `ISSUE_REPORT_WEBHOOK_SECRET`, the other `ISSUE_REPORT_SHEET_WEBHOOK_SECRET`.
2. Open the target Google Sheet → Extensions → Apps Script. Paste the contents
   of `apps-script.gs.txt` (same folder as this README), replace
   `SHARED_SECRET` with your `ISSUE_REPORT_SHEET_WEBHOOK_SECRET` value.
3. Deploy → New deployment → type "Web app". Execute as "Me", access "Anyone".
   Copy the deployment URL — that's `ISSUE_REPORT_SHEET_WEBHOOK_URL`.
4. Set all three secrets above via `supabase secrets set` (or the Dashboard),
   then `supabase functions deploy issue-report-sheet-sync` — this repo does
   not auto-deploy Edge Functions, see the migrations note above for why that
   matters here too.
5. Run the pending migration (`supabase db push`, or paste
   `0077_issue_report_sheet_sync_trigger.sql` into the SQL Editor — migrations
   aren't auto-deployed either). Then, in the SQL Editor, run once (replacing
   the placeholder with your actual `ISSUE_REPORT_WEBHOOK_SECRET` value —
   this command itself is never committed anywhere):
   ```sql
   select vault.create_secret(
     'REPLACE_WITH_YOUR_ISSUE_REPORT_WEBHOOK_SECRET',
     'issue_report_webhook_secret',
     'x-webhook-secret sent to issue-report-sheet-sync'
   );
   ```
