# NLC Edge Functions

The app uses church Logto login, not Supabase Auth, in production.

Current flow:

1. Frontend completes Logto PKCE login.
2. Frontend calls `nlc-session` with the Logto access token.
3. `nlc-session` verifies Logto userinfo and upserts `profiles` / `user_identities` with the service role.
4. Frontend uses a small client shim that calls `nlc-data` for database reads/writes.
5. `nlc-data` verifies the Logto access token on each request, resolves the current profile, and applies server-side table/action restrictions before using the Supabase service role.

### Logto JWT 驗證（`NLC_JWT_VERIFY_MODE`）

2026-09-24 以前，`nlc-data` 與 `nlc-session` 對 Logto JWT **只 base64 解開 payload、不驗簽章**
——任何人都能自己做一張填了別人 `sub` 的 token 冒用身分；`nlc-session` 甚至會拿前端送來、
未驗證的 `id_token` 裡的 email 去比對並綁定既有帳號（可冒用任何已知 email 的帳號，含管理員）。
現在兩支都內嵌同一段 `logto-jwt-verify` 區塊，用 `${NLC_LOGTO_ISSUER}/jwks` 的公開金鑰驗
簽章、`iss`、`exp`（容忍 60 秒時鐘誤差）。

| `NLC_JWT_VERIFY_MODE` | `nlc-data`（每個請求） | `nlc-session`（登入綁帳號） |
|---|---|---|
| `enforce`（預設） | 驗證失敗回 401（拿不到 JWKS 回 503） | **一律擋**：未驗過的 `id_token` 不採用 |
| `report` | 驗證失敗**只記錄、照舊放行** | 同上 |
| `off` | 緊急開關：完全回到舊行為 | 同左 |

上線步驟：

1. 部署 `nlc-session`、`nlc-data`（維持 `report`）。
2. 觀察幾天 Edge Function logs：搜尋 `logto_jwt_verify_summary`（每 5 分鐘一行各結果計數）與
   `logto_jwt_verify_failed`（失敗明細，只含 `reason` / `aud` / `alg` / 過期幾秒，不含 token 或 sub）。
   正常流量應該幾乎全是 `nlc-data:ok`；少量 `expired` 屬正常（前端會自動續期重試）。
   若出現大量 `bad_signature` / `unknown_key` / `unsupported_alg`，**先別切 enforce**，回報處理。
3. 從 log 的 `aud` 確認 access token 的 audience，選填 `NLC_LOGTO_AUDIENCE`（通常是
   `https://platform.newlife.org.tw`）；`id_token` 的 audience 是 Logto app 的 client id，選填 `NLC_LOGTO_CLIENT_ID`。
4. 確認無誤後 `supabase secrets set NLC_JWT_VERIFY_MODE=enforce`（不用重新部署）。

正式站與 staging 都已切到 `enforce`。#564 起程式碼的預設也是 `enforce`：沒設 secret、空字串或設錯值都當 `enforce`，
漏設不會變成放行；要觀察或緊急放行才明確設 `report`／`off`。

Required Supabase Edge Function secrets:

```bash
NLC_LOGTO_ISSUER=https://sso.newlife.org.tw/oidc
NLC_MEMBER_HUB_URL=https://member.newlife.org.tw
NLC_PLATFORM_API_URL=https://platform.newlife.org.tw/platform/v1
APP_ORIGIN=https://bible.newlife.org.tw
```

### CORS 白名單（#553）

`nlc-data`、`nlc-session`、`exam-write` 內嵌同一段 `cors-allowlist` 區塊（`scripts/cors-allowlist.test.mjs`
會比對三份逐字相同），只對下列來源回 `Access-Control-Allow-Origin`，其他網站的瀏覽器請求讀不到回應：

- 正式站 `https://bible.newlife.org.tw`、`https://bible-speed-reading.vercel.app`
- staging `https://bible-speed-reading-staging.vercel.app` 與本專案 Vercel 團隊的 PR 預覽網址
- 本機 `http://localhost:<port>`、`http://127.0.0.1:<port>`
- 後台 `https://bible-speed-reading-admin.vercel.app`、`https://bible-speed-reading-admin-staging.vercel.app`：後台「照搬」的舊管理區塊（#550）在後台網域的 iframe 裡，照舊呼叫這三支（見 `docs/admin-console.md`）
- `APP_ORIGIN`，以及選填的 `APP_ALLOWED_ORIGINS`（逗號分隔的完整 origin，臨時加網域用，不用重新部署）

後台自己重寫的區塊只呼叫 `admin-api`，它有自己的白名單（#547、#555）。

### 共用程式碼（`_shared/`，#564）

計畫進度的規則（落後幾天、最後打卡、需要關心）與「教會原始日程」放在 `supabase/functions/_shared/progress/*.mjs`，
**會友 App、`admin-api`、`nlc-data` 執行同一份**（App 由 `js/data/*`、`js/modules/pastoral-metrics.mjs` 轉出）。
這些檔案只能 import 彼此（不能有 `npm:`、網址、`window`），`scripts/edge-function-deploy-graph.test.mjs` 會擋。

- **部署一律用 CLI**（`npx supabase functions deploy <name> --project-ref <ref>`）：CLI 會跟著相對路徑的 import
  把 `../_shared/...` 一起上傳／打包。只上傳函式自己資料夾的方式（Dashboard 編輯器等）會 `Module not found`
  ——打包失敗時線上照跑舊版，不會半套上線。
- 改了 `_shared/progress` 的任何檔案，**`admin-api` 與 `nlc-data` 都要重新部署**，App 也要重新 build。
- 既有的內嵌區塊（`logto-jwt-verify`、`cors-allowlist`、`exam-write-token`）維持內嵌，不搬。

Supabase provides these default secrets automatically:

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
```

`NLC_SUPABASE_JWT_SECRET` is no longer required. The app no longer signs custom Supabase JWTs.

Both functions must have `verify_jwt = false` because the incoming bearer token is a Logto token, not a Supabase token.

## 後台專用 API（`admin-api`，#547）

只服務後台（#555），和會友 App 的 `nlc-data` 分開。每個 action 對一支 `admin_api_*` SQL 函式（只授權 service_role，`supabase/migrations/20261011110008_admin_api_support.sql`、`20261012045233_admin_api_reports.sql`、`20261012053123_admin_api_accounts.sql`、`20261012102522_admin_api_audit.sql`、`20261013114704_admin_api_plan_progress.sql`）；會改資料的 action 在同一支函式、同一個交易內寫稽核。要同時動 Storage 的（回覆附截圖、刪截圖／回報、匯出 CSV）在 `policy.ts` 用 `run` 串起來，實作在 `reports.ts`、`accounts.ts`、`audit.ts`、`exports.ts`。

- **驗證**：內嵌同一段 `logto-jwt-verify` 區塊，**一律**要驗過簽章／發行者／到期，不看 `NLC_JWT_VERIFY_MODE`。
- **後台應用程式**：token 的 `client_id` 宣告（`ADMIN_API_CLIENT_CLAIM` 可改）要在 `ADMIN_API_ALLOWED_CLIENT_IDS` 裡。**沒設定就全部拒絕**（回 `admin_client_not_configured`）。#554 拿到 client id 前，staging 可以暫時設成會友 App 現有的 client id 方便開發；正式站一定要設後台專用的。
- **權限**：角色讀資料庫（`role_definitions.code`）。`supabase/functions/admin-api/policy.ts` 的角色 → 能力表預設拒絕，目前只有系統管理員有能力（`console.access`、`support.read`、`support.pii`、`support.write`、`accounts.read`、`accounts.write`、`operations.manage`、`content.manage`、`settings.manage`、`audit.read`、`export`、`plans.read`）。
- **限流**：計數在 `admin_api_rate_limits`（搜尋每分鐘 60 次、查看（含使用者名單、管理範圍總覽）每分鐘 120 次、完整個資每小時 30 次、回覆／改狀態／刪截圖／改管理範圍每分鐘 30 次、刪回報每小時 20 次、匯出每小時 20 次），超過回 429 並記 denied。請求本文超過 1 MB 回 413。
- **稽核**：`user_summary` 記 `view_user`、`reveal_pii` 記 `reveal_pii`、打開回報對話記 `view_report`（自動更新 `refresh: true` 不記）、`report.set_status`／`report.reply`／`report.note`／`report.attachment_delete`／`report.delete`（刪除前的內容快照）、`set_profile_managed_scopes`（前後差異、修改原因）、`export`（種類、篩選、筆數）——都在同一個交易內；client 不對、沒有能力、超過限流記 denied（來源 `admin-api`）。
- **稽核紀錄**（#550）：`audit_list`（期間 1／7／30／90／365 天＋動作、結果、來源、操作者、對象；keyset 以紀錄編號由新到舊；第一頁帶總數與選項）、`audit_event`（單筆完整內容）要 `audit.read`，**看不記稽核**；`audit_export`（最多 5000 筆，CSV）另外要 `export`，記 `export`（kind `audit`）。來源篩選前端用 `legacy` 代表 `nlc-data`。動作的中文名稱在 `audit.ts`（由 run 補到每一筆），新增會寫稽核的動作要一起加。
- **計畫總覽／名單**（#564，`plans.ts`，要 `plans.read`）：`plan_summary`（只有數字：漏斗、進度與最後打卡兩個條件各格人數、需要關心分原因、單位比較、今天的日程；**不記稽核**）、`plan_roster`（範圍內每人一列、一次載完、不帶 email；SQL 在同一個交易記 `view_plan_roster`）。範圍一律全教會：`admin_api_plan_info`／`admin_api_plan_people` 先在 SQL 依操作者重查是不是系統管理員（不是就 42501 → 403）。每個人的狀態由 `_shared/progress` 算（和 App 同一份規則）；SQL 另外回 `meta`（範圍內人數、報名人數），對不上時回應的 `meta.consistent` 是 false，後台要警告、不快取。`nlc-data` 也有同名的組長版（`nlc-data/plan-report.ts`）：要能管理計畫（`canManagePlans`），範圍只看 `getVisibleProfileIds`（前端傳的範圍一律不看），經 `get_pastoral_overview` 取資料；打開名單由 `nlc-data` 記 `view_plan_roster`。
- **照搬區塊的匯出**（#550）：`legacy_export_audit` 只記一筆 `export` 稽核（`resource` 是 `legacy:<區塊>`，detail 有檔名、格式、筆數、大小；用既有的 `admin_api_record_event`，不用新 migration），需要 `export`＋該區塊的能力（`LEGACY_EXPORT_SECTIONS`），和其他匯出共用限流。後台外殼記成功才存檔。
- **匯出**：CSV 由伺服器產生（防公式注入，規則同 `js/modules/csv-cell.mjs`；時間用台北時區），前端只負責存檔。使用者名單（`directory_export`，含完整 email，另外要 `support.pii`，上限 10000 人）、組織架構（`org_export`）的欄位與開頭的匯出時間列和 App 管理分頁的匯出相同（`scripts/admin-api-accounts.test.mjs` 比對）。
- **CORS**：只允許 `https://bible-speed-reading-admin.vercel.app`、`https://bible-speed-reading-admin-staging.vercel.app`，加上選填的 `ADMIN_API_ALLOWED_ORIGINS`（逗號分隔）；`ADMIN_API_ALLOW_LOCALHOST=true`（只在 staging 設）才放行本機。其他來源回 403。回應一律 `Cache-Control: no-store`，並回 `x-request-id`；每個請求一行 `admin_api_request` log。

```bash
npx supabase secrets set --project-ref <ref> ADMIN_API_ALLOWED_CLIENT_IDS=<後台 Logto client id>
npx supabase secrets set --project-ref dbtjsljrytzonjvclgrd ADMIN_API_ALLOW_LOCALHOST=true   # 只有 staging
npx supabase functions deploy admin-api --project-ref <ref>
```

呼叫格式：`POST /functions/v1/admin-api`，`Authorization: Bearer <後台 access token>`，body `{ "action": "user_search", "params": { "q": "王" } }`；回 `{ data, request_id }` 或 `{ error, request_id }`。

## 從資料庫呼叫 Edge Function 的網址（Vault `project_url`）

pg_cron 排程和 trigger 呼叫 Edge Function 時，網址由 `public.edge_function_url(name)`
組成：讀 Vault 裡的 `project_url`，接上 `/functions/v1/<name>`（migration `0212`）。
**每個環境都要各自設定自己的網址**；沒設定（或不是 `https://<ref>.supabase.co`）時，
所有排程和 trigger 都只記 WARNING、不發出任何請求。

```sql
-- 正式環境
select vault.create_secret('https://ztozevcqkfrohgjmngcj.supabase.co', 'project_url',
  'Base URL used by edge_function_url() to call this project''s Edge Functions');
-- staging
select vault.create_secret('https://dbtjsljrytzonjvclgrd.supabase.co', 'project_url',
  'Base URL used by edge_function_url() to call this project''s Edge Functions');
```

**正式環境要先設定 `project_url`，再貼 `0212`**，順序反過來排程會悄悄停掉。
新的 migration 不要再寫死 `*.supabase.co` 網址，一律用 `public.edge_function_url(...)`
（`scripts/edge-function-url-from-vault.test.mjs` 會擋）。

## 大測驗作答寫入 (`exam-write`)

作答中的「暫存」與「送出」不帶登入 token，改帶一張**這份作答專用的寫入憑證**，
讓 75 分鐘的測驗不再受 Logto token 續期失敗影響（續期失敗前端會清掉登入，
原本後面的暫存 / 送出就全部失敗）。

- `nlc-data` 在 `exam_get_for_attempt` 回傳作答中的 attempt 時，附上
  `attempt.writeToken` = HMAC-SHA256(`EXAM_WRITE_SECRET`, attemptId + 主人 user_id)，
  無狀態，不存 DB。簽章程式碼**內嵌**在兩支函式的 `index.ts`（`>>> exam-write-token`
  區塊，兩份逐字相同，測試會比對）。當初（2026-09-23）放 `_shared/` 部署時遇到 `Module not found` 才改內嵌；
  用 CLI 部署其實會帶上 `_shared/`（見上方「共用程式碼」），這段維持內嵌、不搬。
- `exam-write` 驗證憑證後，以 service role 呼叫 `exam_save_progress` /
  `exam_submit_attempt`（`p_actor_id` = attempt 主人）。只有這兩支，截止時間 /
  狀態 / 功能開關照 DB 原本的規則。
- 前端（`db.saveExamProgress` / `db.submitExamAttempt`）優先走 `exam-write`；
  沒有憑證、`exam-write` 未部署、憑證被拒（例如換了密鑰）或 5xx 時自動退回
  `nlc-data`。所以部署順序不拘，沒設密鑰就等於沒啟用。

Required Edge Function secret — **`nlc-data` 與 `exam-write` 要設同一個值**：

```bash
EXAM_WRITE_SECRET=<random string, 32+ bytes>   # e.g. openssl rand -base64 48
```

Deploy (`verify_jwt = false` is in `config.toml`; pass the flag anyway, see
`issue-report-sheet-sync` below for why):

```bash
supabase functions deploy exam-write --no-verify-jwt
supabase functions deploy nlc-data --no-verify-jwt
```

No migration needed.

## 每日小測驗生成 (`generate-daily-quizzes`)

This scheduled function resolves the current church-campaign chapters in
`Asia/Taipei`, fetches the scripture once, then generates variants A/B/C with
one generator request plus one blind-review request per variant (see the quality gate below). Database reservation is
atomic, so repeated scheduler invocations and duplicate button clicks cannot
produce duplicate Gemini requests. A pastor or administrator may manually
retry failed variants or replace generated-but-unapproved variants without a
fixed request cap. Approved or published variants are immutable.

Required Edge Function secrets:

```bash
GEMINI_API_KEY=<server-only Gemini API key>
GEMINI_QUIZ_MODEL=gemini-3.1-flash-lite
QUIZ_GENERATION_CRON_SECRET=<random shared secret>
```

Optional:

```bash
GEMINI_QUIZ_REVIEW_MODEL=gemini-3.1-flash-lite   # reviewer (#414); default since #467 — gemini-3.8-flash hung/503ed on the API
QUIZ_GENERATION_BUDGET_SECONDS=140           # whole-invocation time budget (#465); keep it below the platform wall-clock limit
```

Reliability (#465): every Gemini call has a timeout (the remaining budget) and
retries 429/5xx/timeouts with 2s/5s/10s backoff (`gemini-call.ts`). A single call waits at most 60s (draft) / 40s (review) (#467), so a hanging model leaves time for the fallback. The
generator gets 3 attempts; the reviewer gets 2 on `GEMINI_QUIZ_REVIEW_MODEL` and
then 2 on `GEMINI_QUIZ_MODEL` as a fallback reviewer. When the budget runs out
the row is written as failed before the platform kills the function. Failures
are stored as `<step>:<code>[:<model>][ — <Google's message>]`, e.g.
`review:503:gemini-3.8-flash — This model is currently experiencing high demand.`;
the admin calendar translates them into Chinese. Progress is written to
`daily_quizzes.generation_stage` (`queued → scripture → drafting → reviewing →
saving`); a `generating` row with no update for 5 minutes counts as stuck — the
calendar shows it as failed (`generation_timeout`) and 請 AI 出題 / the 20:00
retry can take it over.

Enter only the model ID as the `GEMINI_QUIZ_MODEL` / `GEMINI_QUIZ_REVIEW_MODEL`
value. Do not include quotes, a `models/` prefix, or `GEMINI_QUIZ_MODEL=` in the
value. The function also normalizes these common formatting mistakes before
calling Gemini.

Quality gate (#414): each variant is two Gemini requests, not one. The
generator writes 8 candidate questions in which every option carries
`evidence` (`verseRef`, a verbatim `quote`, `reason`); wrong options must be
contradicted by scripture, not merely unmentioned. `quiz-quality.ts` then
checks every quote really occurs in the cited verses of the day's chapters,
and a second model judges each option blind (no answer given) as
correct / incorrect / undeterminable. A candidate survives only if both pass
and the reviewer finds exactly the intended answer. The first 5 survivors are
stored (with `evidence`); fewer than 5 fails the variant with
`quiz_quality_insufficient:<accepted>/<candidates>`, and the normal retry
schedule takes over. `daily_quiz_quality_check` logs why each candidate was
dropped. `evidence` is shown in the admin quiz calendar only;
`quiz_questions_for_member` does not pass it to members.

Deploy without Supabase JWT verification because pg_cron authenticates with
the custom `x-cron-secret` header:

```bash
supabase functions deploy generate-daily-quizzes --no-verify-jwt
```

`--no-verify-jwt` is mandatory. If the function has no invocation log at all,
the Supabase gateway is usually rejecting the `pg_net` request before the
function starts. Redeploy with the command above and confirm **Enforce JWT
Verification** is disabled in Edge Functions → `generate-daily-quizzes` →
Settings. The function itself still validates `x-cron-secret`.

To inspect the asynchronous `pg_net` response after pressing manual update,
run this in the SQL Editor. A gateway problem appears here as HTTP 401 even
when the Edge Function log is empty:

```sql
select id, status_code, content, error_msg, created
from net._http_response
order by created desc
limit 20;
```

Migration `0085_schedule_daily_church_quizzes.sql` runs it daily at 00:05
Taipei time. Store the same cron secret in Vault once:

```sql
select vault.create_secret(
  'REPLACE_WITH_QUIZ_GENERATION_CRON_SECRET',
  'quiz_generation_cron_secret',
  'x-cron-secret sent to generate-daily-quizzes'
);
```

Generated questions remain `pending` until a pastor or administrator approves
them. Editing a question resets approval; a version already used by a published
quiz is immutable so members never see the content change while answering.

Manual retry/replacement requires migration
`0086_manual_daily_quiz_regeneration.sql` and redeploying both quiz-related
functions:

```bash
supabase functions deploy nlc-data --no-verify-jwt
supabase functions deploy generate-daily-quizzes --no-verify-jwt
```

Apply `0087_optimize_daily_quiz_dashboard.sql` as well. It replaces the
per-group member lookup loops with one set-based membership pass and only
builds member answer details for groups that already have a publication.

Apply `0088_daily_quiz_feature_flag.sql` to add the administrator-controlled
master switch. It defaults to off, preserves all quiz data, hides client entry
points, rejects quiz RPC calls in `nlc-data`, and makes the 00:05 scheduler and
generator return without sending any Gemini request while disabled. Redeploy
both `nlc-data` and `generate-daily-quizzes` after applying it.

Only pastors and administrators can request a retry. Duplicate clicks are
deduplicated by an atomic database status transition. A ready but unapproved
variant asks for confirmation before replacement; once approved, the database
trigger permanently blocks replacement, editing, and approval cancellation.

## 小測驗排程發佈掃描器 (`daily-quiz-schedule-sweep`)

Runs the daily 00:00 auto-publish (#306). Every 5 minutes it calls
`run_daily_quiz_schedule_sweep`, which calls `run_daily_quiz_auto_publish`: for
every plan whose auto-publish rule is on, publish today's quiz (AI version or the
day's custom questions) to all small groups unless the day is skipped. It is
idempotent, so later runs only fill in groups that were missed. The old manual
schedule (`quiz_publication_schedules`, `schedule_daily_quiz_publish`,
`cancel_daily_quiz_schedule`) was removed in #308. It does pure database work
(no external API), same shape as `issue-report-maintenance`, not
`generate-daily-quizzes`.

Required Edge Function secrets:

```bash
DAILY_QUIZ_SCHEDULE_SWEEP_SECRET=<random shared secret>
```

Deploy without Supabase JWT verification, same reason as the other cron jobs —
pg_cron authenticates with the custom `x-cron-secret` header instead:

```bash
supabase functions deploy daily-quiz-schedule-sweep --no-verify-jwt
```

Migration `0189_daily_quiz_scheduled_publish.sql` schedules it every 5 minutes
and adds the `answer_close_at` deadline enforced by `daily_quiz_submit_answer` /
`daily_quiz_finalize_attempt` / `submit_daily_quiz`. Store the same cron
secret in Vault once:

```sql
select vault.create_secret(
  'REPLACE_WITH_DAILY_QUIZ_SCHEDULE_SWEEP_SECRET',
  'daily_quiz_schedule_sweep_cron_secret',
  'x-cron-secret sent to daily-quiz-schedule-sweep'
);
```

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
   then deploy with JWT verification explicitly disabled:
   ```bash
   supabase functions deploy issue-report-sheet-sync --no-verify-jwt
   ```
   `--no-verify-jwt` is required here even though `config.toml` already sets
   `verify_jwt = false` for this function — deploying without the flag left
   the platform gateway enforcing JWT verification anyway, rejecting every
   pg_net request before it ever reached this function's code
   (`sb-error-code: UNAUTHORIZED_NO_AUTH_HEADER`, a 401 from Supabase itself,
   not from the shared-secret check inside `index.ts`). If it ever happens
   again, also check Edge Functions → issue-report-sheet-sync → Settings in
   the Dashboard for an "Enforce JWT Verification" toggle that can override
   `config.toml`. This repo does not auto-deploy Edge Functions either way,
   see the migrations note above for why that matters here too.
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

## 報名與註冊統計 → Google 試算表同步 (`nlc-data`'s `sync_registration_stats_sheet` action)

Unlike `issue-report-sheet-sync`, this is **not** a separate Edge Function or
a DB trigger — it's a new `action` inside `nlc-data` itself, called directly
by an authenticated admin clicking "更新到 Google 試算表" in 系統管理 →
報名與註冊統計. The client (`js/modules/admin.js`) builds the exact row shape
(including the pastoral-zone leader names, looked up from the same source as
組織架構權限總覽); `nlc-data` re-validates `isAdmin(profile)`, sanitizes the
shape, and forwards it — with a shared secret, not the caller's token — to a
Google Apps Script Web App bound to the church's shared "速讀報名統計" sheet.
It **overwrites** the sheet's whole table every time (not an append), so a
shorter region/zone list than last time doesn't leave stale rows.

Required Supabase Edge Function secrets on `nlc-data` (in addition to the
defaults above and its own existing `NLC_*` secrets):

```bash
REGISTRATION_STATS_SHEET_WEBHOOK_URL=<Apps Script Web App /exec URL>    # from step 2 below
REGISTRATION_STATS_SHEET_WEBHOOK_SECRET=<random string you choose>      # checked by the Apps Script doPost, see registration-stats-apps-script.gs.txt
```

### One-time setup

1. Pick a random secret string for `REGISTRATION_STATS_SHEET_WEBHOOK_SECRET`.
2. Open the target Google Sheet ("速讀報名統計") → Extensions → Apps Script.
   Paste the contents of `registration-stats-apps-script.gs.txt` (same folder
   as this README), replace `SHARED_SECRET` with the value from step 1. Then
   Deploy → New deployment → type "Web app", execute as "Me", access "Anyone".
   Copy the deployment URL — that's `REGISTRATION_STATS_SHEET_WEBHOOK_URL`.
3. Set both secrets above via `supabase secrets set` (or the Dashboard) and
   redeploy `nlc-data`:
   ```bash
   supabase functions deploy nlc-data --no-verify-jwt
   ```
   (`nlc-data` already needs `--no-verify-jwt` for the Logto-token reasons
   described at the top of this README — this isn't new for this feature,
   just a reminder it's still required after adding the two secrets above.)
4. No new migration and no Vault secret needed — this path never touches
   Postgres directly for delivery; it only calls the existing
   `get_admin_registration_statistics` RPC indirectly (via the admin panel
   already loading its data), then forwards what's already on screen.
