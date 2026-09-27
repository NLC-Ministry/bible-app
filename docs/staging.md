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

## 開發流程：在 staging 分支上工作（2026-09-27 起）

| 分支 | 網站 | 資料庫 |
|---|---|---|
| `staging`（日常開發都在這裡） | https://bible-speed-reading-staging.vercel.app | staging `vzokpsscyivhgmhleplq` |
| `main`（只透過上線 PR 更新） | https://bible.newlife.org.tw | 正式 `ztozevcqkfrohgjmngcj` |

- **日常修改直接 commit 到 `staging` 再 push**。CI 會跑測試、部署成 **preview**（用 Vercel Preview 的環境變數，連 staging 資料庫），再綁到固定網址。
- **不要 force push `staging`**：它上面可能有還沒上線的修改，蓋掉就不見了。
- **大功能**（要做好幾天、或有上線順序要求，例如大測驗 C3）從 `staging` 開短期分支，完成後 merge 回 `staging`。不然會跟其他修改綁在一起上線。
- **不要直接 push 到 `main`**。免費的私人 repo 不能設定分支保護，所以改成在部署時把關：不是從 `staging`（或 `hotfix/*`）的 PR merge 進來的 commit，CI 不會部署到正式環境（見下方「上線到正式環境」）。
- **正式環境的緊急修正**：staging 上有還沒準備好上線的東西時，從 `main` 開 `hotfix/<名稱>` 分支 → 開 PR 到 `main` → 照上線流程審核 → merge 後，把 `main` 併回 `staging`：`git switch staging && git merge origin/main && git push`。
- migration 跟著分支走：commit 到 `staging` 時推到 staging 資料庫；上線時推到正式資料庫（見下方「套用 migration」）。

## 上線到正式環境（審核機制）

**在 staging 網站確認沒問題後，按 merge 就代表確認上線。**

1. 在 GitHub 開 PR：**`staging` → `main`**。PR 會自動帶出檢查清單（`.github/pull_request_template.md`），每一項寫成「打開哪個頁面 → 應該看到什麼」。
2. 照清單在 **staging 網站**確認。
3. 沒問題就按 **Merge**（選 **Create a merge commit**，不要用 squash，兩條分支的歷史才不會分岔）。有問題就先不要 merge。
4. CI 部署正式環境前會檢查：這個 commit 必須來自從 `staging`（或 `hotfix/*`）開出來、已經 merge 的 PR。**直接 push 到 `main` 的不會部署**，正式網站維持原狀。
5. 開發者完成上線後的步驟：正式環境 migration、Edge Function、確認正式網站、`compare-env-snapshots.mjs --run`。

PR 上的 `release-gate` 檢查會確認來源分支是 `staging`（或 `hotfix/*`），而且已經包含 `main` 上所有的修改（緊急修正要先併回 staging）。

## 每日靈修與小組聚會（政策審核中，2026-09-27 起）

這兩個功能還在等政策通過，**內容一律在 staging 編輯與測試**：

| | 正式環境 | staging |
|---|---|---|
| `app_feature_settings.devotion_group_hidden` | **TRUE**：對所有人隱藏，含管理員 | **FALSE**：管理員看得到後台，可以編輯內容 |
| 內容（`global_plans` 的 devotional / group_meeting、`plan_devotion_days`、`plan_group_meeting_weeks`） | 保留 2026-09-16 的版本，不再修改 | **以這裡為準** |

- 後台**沒有**「完全隱藏」開關（已移除），`db.updateFeatureSetting` 也不能改這個旗標，避免有人誤按提前公開。
- 要讓 staging 的會友端也看得到，在 staging 後台「功能設定」打開每日靈修／小組經營的總開關，再到「個人 → 功能設定」打開自己的偏好。
- **政策通過要上線時**（之後另外處理）：
  1. 把 staging 的這兩個功能的內容複製到正式環境（到時候寫一支只複製這幾張表的工具，比照 `staging-sample-data.mjs`）。
  2. 新增 migration：`UPDATE public.app_feature_settings SET enabled = FALSE WHERE key = 'devotion_group_hidden';`
  3. 跟著一次上線 PR 發布，由維護者按 merge 確認。

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
