# 管理後台（#555）

後台重新設計系列（總覽 #546）的前端。和會友 App **不同網域、不同 Vercel 專案、不同 Logto 應用程式**，只呼叫 `admin-api`（#547）。

| | 正式站 | staging |
|---|---|---|
| 網址 | https://bible-speed-reading-admin.vercel.app | https://bible-speed-reading-admin-staging.vercel.app |
| Vercel | 後台專案的 production | 後台專案的 preview，CI 綁固定別名 |
| admin-api | `ztozevcqkfrohgjmngcj` | `dbtjsljrytzonjvclgrd` |
| Logto 應用程式 | 正式站的後台 client（#554） | staging 的後台 client（#554） |

為什麼要分開：會友 App 的 localStorage、innerHTML 渲染和管理員共用的話，會友 App 任何一處 XSS 都等於拿到管理員的 token。分開後，會友 App 被攻破也讀不到後台的任何東西，偷到的會友 token 也打不進 `admin-api`（它只收後台應用程式發的 token）。

## 檔案

- `admin/admin.html` → `admin/admin-entry.tsx`：入口。React＋TypeScript，不載入會友 App 的核心鏈（`state.js`、`db.js` 等全域）。
- `admin/src/`：`auth.ts`（登入）、`api.ts`（admin-api 呼叫與快取）、`idle.ts`（閒置登出）、`route.ts`（網址）、`nav.ts`（導覽與能力）、`App.tsx`（外殼）、`download.ts`（把伺服器產生的 CSV 存檔）、`views/`（客服：回報收件匣 `ReportInbox.tsx`／對話 `ReportThread.tsx`、搜尋、某個人；帳號與權限：`AccountsArea.tsx`、使用者名單 `UserDirectory.tsx`、管理範圍 `ScopeManager.tsx`）、`directory.ts`（名單篩選規則）、`scopes.ts`（管理範圍規則，和 App 管理分頁相同，`admin/__tests__/scopes.test.ts` 比對）。截圖壓縮與診斷摘要和會友 App 共用 `lib/issue-report/`（純函式，不碰會友 App 的全域；後台不能 import `components/issue-report/`）。
- `admin/admin.css`：全部樣式。色票和 `index.css` 同一套 token，三種主題（`<html data-theme>`），值由 `scripts/admin-console.test.mjs` 比對。
- `scripts/build-admin.mjs`：建置到 `dist-admin/`（只有 `index.html`、`admin.<hash>.js`、`admin.<hash>.css`、`favicon.svg`、`robots.txt`）。
- `vercel.admin.json`：後台專案的 Vercel 設定（建置指令、輸出目錄、安全標頭）。CI 部署後台時把它複製成 `vercel.json`。
- `js/admin-console-link.mjs`：會友 App 連到後台的固定網址（回報管理的「在後台查看此使用者」）。

## 規則

- **安全標頭直接強制**（不走觀察模式）：CSP `default-src 'none'`；腳本、樣式只允許自家；連線只允許兩個 Supabase 專案（admin-api）和 Logto；圖片允許自家、`data:`、Supabase Storage；`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'self'`、`object-src 'none'`。加 `X-Robots-Tag: noindex`，HTML 回 `Cache-Control: no-store`。
- **不寫行內腳本、行內 style、`dangerouslySetInnerHTML`**。React 的 `style={…}` 也不用（測試會擋）；會友輸入的內容一律當文字顯示。
- **token 只放記憶體**，沒有 refresh token（scope 不含 `offline_access`）。過期或重新整理就重新導向 SSO（Logto 已登入時不用再輸入密碼）。sessionStorage 只放 PKCE 這一趟的一次性資料與「剛登出」旗標；localStorage 只放主題偏好；不用 IndexedDB、cookie、Service Worker。
- **閒置 30 分鐘自動登出**，並結束 Logto 的登入狀態（只清記憶體的話，重新整理又會無聲登回來）。登出前 1 分鐘提醒。
- **請求預算**：開後台＝`bootstrap`＋預設頁（回報收件匣）的 1 個 `report_list`（第一頁順便帶各狀態筆數）；打開一張回報只打 1 個 `report_thread`，之後畫面在前景時每 20 秒自動更新（`refresh: true`，不重複記稽核）；診斷資訊展開才打 `report_diagnostics`。收件匣清單放在客服區那一層，切到「查詢使用者」再回來不重抓。打開某人只打 1 個（`user_summary`，裡面已有各區塊最新 5 筆與總數）；「載入更多」才打 `user_section`，切到時間軸才打 `user_timeline`。記憶體快取 60 秒，同一個人切換區塊不重抓。使用者名單：打開 1 個 `directory_list`（第一頁順便帶計畫選項與預設計畫），改條件 1 個（搜尋字停 300ms 才送），「載入更多」1 個；管理範圍：打開 1 個 `scope_overview`（組織名單用 `bootstrap` 帶的），點某位負責人不再打，儲存 1 個 `scope_set`、成功後就地更新。兩個分頁的資料放在帳號區那一層，切分頁再回來不重抓。測試：`admin/__tests__/request-budget.test.tsx`、`report-inbox.test.tsx`、`accounts.test.tsx`。
- **會改資料的動作要 `support.write`**（回覆、內部備註、改狀態、刪截圖、刪回報），沒有這個能力的帳號看不到輸入框和按鈕；伺服器端在同一個交易內寫稽核。刪回報要再確認一次，可填原因（記進稽核）。
- **帳號與權限**：看名單、管理範圍要 `accounts.read`，改管理範圍要 `accounts.write`（沒有的話勾選框停用、沒有儲存鈕）。名單在伺服器端篩選、分頁（一次 50 人、email 遮罩），不像 App 一次把全部的人和完整 email 載進瀏覽器。**角色由會員中心同步，後台不改角色**；只改大區長／區長／小組長的管理範圍（`set_profile_managed_scopes`，名稱要在組織名單裡），可填修改原因，稽核記前後差異。
- **匯出一律由伺服器產生**（`report_export` 需要 `support.read`＋`export`；含完整 email 的 `directory_export` 需要 `accounts.read`＋`export`＋`support.pii`；`org_export` 需要 `accounts.read`＋`export`；都記 `export` 稽核，欄位和 App 的匯出相同）；前端只存檔，不自己組 CSV。之後搬過來、還沒改寫的舊區塊若暫時在前端組 CSV，下載前必須先成功呼叫 admin-api 記稽核，記不到就不下載。
- **截圖**：回覆可附 1 張（瀏覽器先壓到約 300 KB，伺服器上限 500 KB，PNG／JPEG／WebP）。顯示用 5 分鐘有效的簽名網址，存檔路徑不送到前端。
- **個資預設遮罩**：按「顯示」才呼叫 `reveal_pii`（伺服器記稽核，需要 `support.pii` 能力）。可以附上查看理由，會記進 `view_user`／`reveal_pii` 稽核。
- **導覽依能力**：`bootstrap` 回的能力清單決定左側顯示哪幾區（`admin/src/nav.ts`）；伺服器端 `admin-api` 仍會再擋一次。客服（回報收件匣、查詢使用者）、帳號與權限（使用者名單、管理範圍）已搬好；其他三區 #550 陸續搬過來，搬好之前只放說明和回 App 管理分頁的連結。
- **新增 admin-api action**：先照 `supabase/functions/admin-api/policy.ts` 的規則加進 `ADMIN_ACTIONS`，前端再加進 `admin/src/api.ts` 的 `AdminAction`，並決定要不要快取（顯示個資、會改資料的不要）。
- **會友 App 的網域不提供後台**、後台網域也不提供會友 App：`dist/` 不會有後台檔案，`dist-admin/` 只有後台（`scripts/bundle.test.mjs`、`scripts/admin-console.test.mjs`）。

## 設定（一次性，維護者操作）

### 1. Logto 應用程式（#554）

正式站、staging 各一個 SPA 應用程式：

- Redirect URI 與登出後導向都填網站根目錄：`https://bible-speed-reading-admin.vercel.app/`、`https://bible-speed-reading-admin-staging.vercel.app/`（staging 另加本機 `http://localhost:4174/`）。
- Scopes：`openid profile email`，**不要** `offline_access`。resource 和會友 App 相同（`https://platform.newlife.org.tw`）。
- access token 要有標示應用程式的宣告（預設看 `client_id`，不同名稱就設 `ADMIN_API_CLIENT_CLAIM`）。

### 2. Vercel 後台專案

在同一個 Vercel team 新增專案 `bible-speed-reading-admin`（不要連 Git；部署由 CI 做）。Framework 選 Other，其他設定由 `vercel.admin.json` 決定。Deployment Protection 比照會友 App 的專案，staging 別名才打得開。

環境變數（**一般變數，不要勾 Sensitive**——Sensitive 的值 `vercel pull` 拿不到，建置會失敗）：

| 變數 | Production | Preview |
|---|---|---|
| `ADMIN_LOGTO_CLIENT_ID` | 正式站後台 client id | staging 後台 client id |
| `ADMIN_API_URL` | `https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/admin-api` | `https://dbtjsljrytzonjvclgrd.supabase.co/functions/v1/admin-api` |

選填：`ADMIN_LOGTO_ISSUER`（預設 `https://sso.newlife.org.tw/oidc`）、`ADMIN_LOGTO_RESOURCE`（預設 `https://platform.newlife.org.tw`）、`ADMIN_LOGTO_SCOPES`（預設 `openid profile email`）、`ADMIN_ENVIRONMENT`（預設看 `ADMIN_API_URL` 是哪個 Supabase 專案）。

### 3. GitHub secret

`VERCEL_ADMIN_PROJECT_ID`：後台專案的 Project ID（Vercel 專案 Settings → General）。沒設之前，CI 的 `deploy-admin` 會跳過、不會失敗。`VERCEL_ORG_ID`、`VERCEL_TOKEN` 和會友 App 共用。

### 4. Supabase（admin-api）

```bash
npx supabase secrets set --project-ref dbtjsljrytzonjvclgrd ADMIN_API_ALLOWED_CLIENT_IDS=<staging 後台 client id>
npx supabase secrets set --project-ref dbtjsljrytzonjvclgrd ADMIN_API_ALLOW_LOCALHOST=true
npx supabase secrets set --project-ref ztozevcqkfrohgjmngcj ADMIN_API_ALLOWED_CLIENT_IDS=<正式站後台 client id>
```

細節見 `supabase/functions/README.md` 的 admin-api 一節。

## 本機預覽

```bash
ADMIN_LOGTO_CLIENT_ID=<staging 後台 client id> npm run build:admin
npx serve dist-admin -l 4174
```

`.claude/launch.json` 也有同樣的 `bible-study-admin`。`ADMIN_API_URL` 沒設時用 `.env` 的 `SUPABASE_URL`。要真的登入，staging 的後台 client 要有 `http://localhost:4174/` 這個 Redirect URI，staging 的 admin-api 要設 `ADMIN_API_ALLOW_LOCALHOST=true`。本機預覽不套用 `vercel.admin.json` 的標頭，CSP 要在 staging 網址上確認（`curl -I https://bible-speed-reading-admin-staging.vercel.app/`）。
