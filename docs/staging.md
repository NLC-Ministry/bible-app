# Staging 環境

測試一律在 staging 做，和正式資料完全分開（Epic #264）。

| | 正式環境 | staging |
|---|---|---|
| Supabase project ref | `ztozevcqkfrohgjmngcj` | `vzokpsscyivhgmhleplq`（Supabase 分支） |
| 網址 | `https://ztozevcqkfrohgjmngcj.supabase.co` | `https://vzokpsscyivhgmhleplq.supabase.co` |
| 前端 | `https://bible.newlife.org.tw`（也可從 `bible-speed-reading.vercel.app` 進入） | `https://bible-speed-reading-staging.vercel.app`（`staging` 分支）、PR 的 preview、本機 `http://localhost:3100` |
| 資料 | 真實會員資料 | 去識別化樣本：310 位「測試會友」及其讀經、測驗、小測驗資料（見下方） |

## 規則

- **Supabase CLI 一律明確指定環境**：`--project-ref ztozevcqkfrohgjmngcj` 或 `--project-ref vzokpsscyivhgmhleplq`。不要依賴 `supabase link`；`supabase/.temp/` 已加進 `.gitignore`。
- **每個 secret 在兩個環境都不同**，不能沿用正式環境的值。
- **對外有副作用的設定，staging 預設不啟用**：`GEMINI_API_KEY`、兩個 Google Sheet webhook（`ISSUE_REPORT_SHEET_WEBHOOK_*`、`REGISTRATION_STATS_SHEET_WEBHOOK_*`）、各排程的 cron secret、pg_cron 排程。要測到那個功能時才設定，並接到測試用的目的地。
- **Staging 的防護跟正式環境一樣**：之後會有 Logto 同步進來的真實個資（#265）。
- migration 用 Supabase CLI 套用：先 staging、驗證後再正式環境（見下方「套用 migration」）。不要再手動貼到 SQL Editor。

## Staging 目前的設定（2026-09-25）

- 結構：和正式環境一致（含 0211–0214）。
- Vault：只有 `project_url` = `https://vzokpsscyivhgmhleplq.supabase.co`（見 `supabase/functions/README.md`）。
- Storage：私有 bucket `issue-report-shots`，和 0153 一致。
- Edge Functions：8 支都已部署（`--no-verify-jwt`）。
- Secrets：`NLC_LOGTO_ISSUER`、`NLC_MEMBER_HUB_URL`、`NLC_PLATFORM_API_URL`、`NLC_JWT_VERIFY_MODE=enforce`、`EXAM_WRITE_SECRET`（staging 專用）。
- pg_cron 排程：沒有。
- 樣本資料：2026-09-25 匯入（見下方「樣本資料」）。
- Logto：staging 專用的 client（2026-09-26 建立），和正式環境的 client 分開（見下方「登入」）。
- 尚未完成：第一個管理員。

## 部署前端到 staging

`staging` 分支一 push，CI 就會部署成 **preview**（用 Vercel Preview 的環境變數，連 staging 資料庫），再綁到固定網址 **https://bible-speed-reading-staging.vercel.app**。`staging` 分支是拿來測試用的，想測哪個分支就把它推上去：

```bash
git push --force-with-lease origin <要測試的分支>:staging
```

- **不要用 `bible-speed-reading.vercel.app` 當 staging**：它跟 `bible.newlife.org.tw` 是同一個正式部署。PWA 的登入狀態和離線讀經紀錄是依網址分開保存的，改用它的話，曾經從這個網址安裝 app 的會友會默默改連 staging，離線紀錄也會送到 staging。
- **Deployment Protection**：staging 網址是 preview 部署，一樣要登入 Vercel 才看得到。免費方案只有專案擁有者能看；如果要讓同工一起測試，要在 Vercel 關掉 Preview 的 Deployment Protection（資料仍然要用 NLC 帳號登入才看得到）。
- **登入**：staging 用自己的 Logto client，不和正式環境共用（#265）。
  - **Vercel 環境變數**：`NLC_CLIENT_ID` 分成兩筆，**Production** 填正式 client ID，**Preview** 填 staging client ID。CI 部署 staging 時跑 `vercel pull --environment=preview`，所以 staging 讀的是 Preview 那筆。環境變數在 build 時才寫進 `config.js`，改完要重新部署一次（把分支推到 `staging`，或在 GitHub Actions 重跑）才會生效。CI log 的 `deploy` → `Build` 步驟會印出這次用到的 `NLC Client ID`，可以用來確認。
  - **Redirect URIs**：`https://bible-speed-reading-staging.vercel.app/` 和 `http://localhost:3100/`，結尾都要有 `/`。程式用 `window.location.origin + "/"` 當 redirect URI，Logto 逐字比對，port 也要完全一樣。
  - **CORS allowed origins**：`https://bible-speed-reading-staging.vercel.app` 和 `http://localhost:3100`，結尾**不加** `/`。
  - **Post sign-out redirect URIs** 用不到：登出只清本機 token，不會導到 Logto 的 end-session。
  - 正式環境的 client 只登記正式網域，不要把 staging 網址加進去。
  - 按登入跳出「教會系統登入尚未完成設定」，代表頁面上的 client ID 是空的：可能 build 時 Preview 還沒設 `NLC_CLIENT_ID`，或瀏覽器還在跑 Service Worker 快取的舊版。先看 CI log 的 client ID，有的話開 `/repair` 清快取再試。
  - `nlc-session` 的 `NLC_LOGTO_CLIENT_ID` secret（選填，檢查 id_token 的 `aud`）staging 目前沒設；之後要設的話，staging 要填 staging client ID，不是正式的。
  - **只有從這兩個網址打開才能登入。** Vercel 每次部署自動產生的網址（`bible-speed-reading-<隨機字串>-...vercel.app`，包括 PR 留言裡的 preview 網址）每次都不同，無法事先登記，從那些網址打開時 Logto 會回報 redirect URI 不符。要測某個 PR 的登入，就把它推到 `staging` 分支，再從固定網址打開。
- `APP_ORIGIN` 不用設定：沒設時 `nlc-data`、`nlc-session` 回 `Access-Control-Allow-Origin: *`，`exam-write` 回請求來源。這些 API 用 Bearer token 驗證、不靠 cookie，`*` 不會讓別的網站拿到資料。反而設了之後只能填一個網址，從 `http://localhost:3100` 連 staging 會被 CORS 擋掉。
- `NLC_LOGTO_AUDIENCE` 不用設：access token 的 audience 由登入時的 `resource` 參數決定（`config.js` 的 `platformResource`，預設 `https://platform.newlife.org.tw`），兩個 client 一樣，分不出環境；正式環境也沒設。

## 套用 migration（#255）

2026-09-25 起改用 Supabase CLI。兩個環境的 `supabase_migrations.schema_migrations` 都已經記錄 0001–0214 為已套用，CLI 會記住每個環境推過哪些 migration。

**建立新 migration**（檔名會是時間戳，例如 `20260926093000_add_xxx.sql`）：

```bash
npx supabase migration new add_xxx
```

**不要再用 `0215_xxx.sql` 這種四位數編號**：`db push` 會拒絕（比遠端最新版本還舊），`scripts/migration-naming.test.mjs` 也會失敗。

**套用**（一律明確指定環境，不依賴 `supabase link`）：

```bash
# 1. staging：先看會跑哪些，再真的套用
npx supabase db push --linked --project-ref vzokpsscyivhgmhleplq --dry-run
npx supabase db push --linked --project-ref vzokpsscyivhgmhleplq

# 2. 在 staging 驗證功能

# 3. 正式環境
npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj --dry-run
npx supabase db push --linked --project-ref ztozevcqkfrohgjmngcj

# 4. 確認兩邊還是一致
node scripts/compare-env-snapshots.mjs --run
```

注意：
- **正式環境不要加 `--include-all`**。那會把遠端沒有紀錄的舊 migration 全部補跑。
- migration 檔頭寫的**順序要求 CLI 不會檢查**，例如 0212 的「先設定 Vault `project_url` 再套用」。推之前先讀檔頭。
- `20260925071804_branch_baseline.sql` 是開分支時 Supabase 寫入的版本號的佔位檔，不要刪。
- 需要登入（`npx supabase login`），不需要資料庫密碼。

## 樣本資料（#267）

`scripts/staging-sample-data.mjs` 從正式環境**只讀**匯出去識別化樣本，匯入 staging。個資在正式資料庫裡就換掉，原始個資不會離開正式環境。

| 資料 | 處理 |
|---|---|
| 會員 | 依大區分層抽 25%（2026-09-25：310 人）。姓名 → `測試會友 0001`、email → `user0001@example.invalid`；電話、頭像、NLC 會員編號、Member Hub 同步欄位清空 |
| 會員 UUID | 用每次匯出隨機產生的鹽值重新編號；鹽值不寫進檔案，staging 的 id 對不回正式環境的真人 |
| 組織 | 名稱換成 `大區 A`、`牧區 A-1`、`小組 A-1-3`，結構不變；`profiles.managed_*` 等以名稱存的欄位同步換掉 |
| 自由文字 | 宣示姓名、簡答作答、批改評語、經文筆記、關心訊息、通知、隊名、邀請碼 → 假文字 |
| 教會內容 | 讀經計畫、靈修、考卷與題目、小測驗、公告：原樣。人員欄位沒被抽到的改成 NULL 或佔位帳號 |
| 不匯出 | `user_identities`、回報與回報對話、兩張稽核記錄表、批改草稿、試考名單 |

```bash
node scripts/staging-sample-data.mjs export ../staging-sample.json   # 只讀正式環境，約 6 分鐘
node scripts/staging-sample-data.mjs check  ../staging-sample.json   # 個資檢查，有錯誤就不要匯入
node scripts/staging-sample-data.mjs import ../staging-sample.json   # 只會寫入 staging，約 10 分鐘
```

- **匯出檔不要 commit**（`staging-sample*.json` 已加進 `.gitignore`），放在 repo 以外，匯入後就刪除。
- `import` 的目標寫死為 staging；匯入前會自動跑個資檢查，沒通過就拒絕。
- 可以重複執行：先刪掉 email 結尾是 `@example.invalid` 的樣本會員（連帶刪除他們的資料），再匯入。之後用 Logto 登入 staging 的真人帳號不受影響；教會內容已存在的列會略過（`ON CONFLICT DO NOTHING`）。
- 匯入時暫時關閉 trigger 和 FK 檢查（`session_replication_role = replica`），匯入後會檢查主要的外鍵關聯。

## 比對兩個環境是否一致（#266）

`supabase/queries/environment_consistency_check.sql` 是**只讀**的查詢，會列出資料表、欄位、constraint、index、trigger、view、RLS policy、資料表與函式權限、函式內容（md5）、enum、預設權限、Storage bucket、pg_cron 排程、Vault secret 名稱（不讀值）。

**自動比對**（需要先 `npx supabase login`，不需要資料庫密碼）：

```bash
node scripts/compare-env-snapshots.mjs --run
```

**手動比對**：在兩個環境的 SQL Editor 各跑一次那支 SQL，把結果匯出成 CSV，再：

```bash
node scripts/compare-env-snapshots.mjs prod.csv staging.csv
```

有非預期差異時 exit code 為 1。以下差異**預期會出現**，會列出但不算錯誤：

| 類別 | 原因 |
|---|---|
| `cron_job` | staging 刻意不建排程 |
| `vault_secret_name` | staging 只設定 `project_url` |
| `extension_version` | Supabase 平台會自動升級 extension，兩邊版本可能不同 |

**什麼時候要跑**：
- 每次把 migration 貼到正式環境之後，確認 staging 也套用了同一支。
- 懷疑正式環境有 repo 以外的手動修改時。
- 權限相關的變更之後：`function_grant` 裡 `anon=true` 的函式都值得檢查（見 0214）。
