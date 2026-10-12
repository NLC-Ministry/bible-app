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
- `admin/src/`：`auth.ts`（登入）、`api.ts`（admin-api 呼叫與快取）、`idle.ts`（閒置登出）、`route.ts`（網址）、`nav.ts`（導覽與能力）、`App.tsx`（外殼）、`download.ts`（把伺服器產生的 CSV 存檔）、`views/`（客服：回報收件匣 `ReportInbox.tsx`／對話 `ReportThread.tsx`、搜尋、某個人；帳號與權限：`AccountsArea.tsx`、使用者名單 `UserDirectory.tsx`、管理範圍 `ScopeManager.tsx`；系統：稽核紀錄 `AuditLog.tsx`；內容、系統兩區上方的分頁 `AreaTabs.tsx`）、`directory.ts`（名單篩選規則）、`audit.ts`（稽核紀錄的篩選與變更內容顯示）、`tabs.ts`（內容、系統兩區的分頁與各自要的能力）、`scopes.ts`（管理範圍規則，和 App 管理分頁相同，`admin/__tests__/scopes.test.ts` 比對）。截圖壓縮與診斷摘要和會友 App 共用 `lib/issue-report/`（純函式，不碰會友 App 的全域；後台不能 import `components/issue-report/`）。
- `admin/admin.css`：全部樣式。色票和 `index.css` 同一套 token，三種主題（`<html data-theme>`），值由 `scripts/admin-console.test.mjs` 比對。
- `admin/src/legacy.ts`、`admin/src/views/LegacyHost.tsx`：照搬的舊管理區塊（見下面「照搬的舊管理區塊」）外殼這一端。
- 和 admin-api 共用的規則只放在沒有 import 的小檔（目前只有 `supabase/functions/admin-api/search-query.ts`）；後台不 import `policy.ts`，否則整個 admin-api 的伺服器程式會被打包進後台（`scripts/admin-console.test.mjs` 擋）。
- `admin-legacy/`：照搬區塊的 iframe 頁（`/legacy`）。`legacy-entry.js` 載入 App 管理分頁的同一份程式；`globals.js`（全域設定，一定第一個 import）、`legacy-auth.mjs`（取代 `js/auth.js`，token 向外殼要）、`memory-storage.mjs`、`export-guard.mjs`、`bridge.mjs`、`sections.mjs`、`legacy.css`（藏掉 App 外框）。
- `scripts/build-admin.mjs`：建置到 `dist-admin/`：外殼（`index.html`、`admin.<hash>.js`、`admin.<hash>.css`、`favicon.svg`、`robots.txt`）和照搬區塊（`legacy.html`、`legacy.<hash>.js`、`legacy.<hash>.css`、`assets/`）。
- `vercel.admin.json`：後台專案的 Vercel 設定（建置指令、輸出目錄、安全標頭）。CI 部署後台時把它複製成 `vercel.json`。
- `js/admin-console-link.mjs`：會友 App 連到後台的固定網址（回報管理的「在後台查看此使用者」）。

## 規則

- **安全標頭直接強制**（不走觀察模式）：外殼（`/legacy` 以外的路徑）CSP `default-src 'none'`；腳本、樣式只允許自家；連線只允許兩個 Supabase 專案（admin-api）和 Logto；圖片允許自家、`data:`、Supabase Storage；`frame-src 'self'`（只嵌自己的 `/legacy`）、`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'self'`、`object-src 'none'`、`X-Frame-Options: DENY`。照搬區塊（`/legacy…`）另一份，見下面。加 `X-Robots-Tag: noindex`，HTML 回 `Cache-Control: no-store`。
- **不寫行內腳本、行內 style、`dangerouslySetInnerHTML`**。React 的 `style={…}` 也不用（測試會擋）；會友輸入的內容一律當文字顯示。
- **token 只放記憶體**，沒有 refresh token（scope 不含 `offline_access`）。過期或重新整理就重新導向 SSO（Logto 已登入時不用再輸入密碼）。sessionStorage 只放 PKCE 這一趟的一次性資料與「剛登出」旗標；localStorage 只放主題偏好；不用 IndexedDB、cookie、Service Worker。
- **閒置 30 分鐘自動登出**，並結束 Logto 的登入狀態（只清記憶體的話，重新整理又會無聲登回來）。登出前 1 分鐘提醒。
- **請求預算**：開後台＝`bootstrap`＋預設頁（回報收件匣）的 1 個 `report_list`（第一頁順便帶各狀態筆數）；打開一張回報只打 1 個 `report_thread`，之後畫面在前景時每 20 秒自動更新（`refresh: true`，不重複記稽核）；診斷資訊展開才打 `report_diagnostics`。收件匣清單放在客服區那一層，切到「查詢使用者」再回來不重抓。打開某人只打 1 個（`user_summary`，裡面已有各區塊最新 5 筆與總數）；「載入更多」才打 `user_section`，切到時間軸才打 `user_timeline`。記憶體快取 60 秒，同一個人切換區塊不重抓。使用者名單：打開 1 個 `directory_list`（第一頁順便帶計畫選項與預設計畫），改條件 1 個（搜尋字停 300ms 才送），「載入更多」1 個；管理範圍：打開 1 個 `scope_overview`（組織名單用 `bootstrap` 帶的），點某位負責人不再打，儲存 1 個 `scope_set`、成功後就地更新。兩個分頁的資料放在帳號區那一層，切分頁再回來不重抓。稽核紀錄：打開 1 個 `audit_list`（第一頁順便帶總數與「動作」「操作者」選項），改條件 1 個，「載入更多」1 個；點開一筆不再打（清單已帶變更內容），只有內容太大被省略的那筆打 1 個 `audit_event`；`audit_list` 快取 60 秒，切到功能開放設定再回來不重抓（重新整理鈕不用快取）。測試：`admin/__tests__/request-budget.test.tsx`、`report-inbox.test.tsx`、`accounts.test.tsx`、`audit.test.tsx`。
- **會改資料的動作要 `support.write`**（回覆、內部備註、改狀態、刪截圖、刪回報），沒有這個能力的帳號看不到輸入框和按鈕；伺服器端在同一個交易內寫稽核。刪回報要再確認一次，可填原因（記進稽核）。
- **帳號與權限**：看名單、管理範圍要 `accounts.read`，改管理範圍要 `accounts.write`（沒有的話勾選框停用、沒有儲存鈕）。名單在伺服器端篩選、分頁（一次 50 人、email 遮罩），不像 App 一次把全部的人和完整 email 載進瀏覽器。**角色由會員中心同步，後台不改角色**；只改大區長／區長／小組長的管理範圍（`set_profile_managed_scopes`，名稱要在組織名單裡），可填修改原因，稽核記前後差異。
- **匯出一律由伺服器產生**（`report_export` 需要 `support.read`＋`export`；含完整 email 的 `directory_export` 需要 `accounts.read`＋`export`＋`support.pii`；`org_export` 需要 `accounts.read`＋`export`；`audit_export` 需要 `audit.read`＋`export`、最多 5000 筆；都記 `export` 稽核，欄位和 App 的匯出相同）；前端只存檔，不自己組 CSV。照搬區塊的匯出是例外（舊程式在瀏覽器組檔），但下載前一定先成功呼叫 `legacy_export_audit` 記稽核，記不到就不下載（見下面）。
- **截圖**：回覆可附 1 張（瀏覽器先壓到約 300 KB，伺服器上限 500 KB，PNG／JPEG／WebP）。顯示用 5 分鐘有效的簽名網址，存檔路徑不送到前端。
- **個資預設遮罩**：按「顯示」才呼叫 `reveal_pii`（伺服器記稽核，需要 `support.pii` 能力）。可以附上查看理由，會記進 `view_user`／`reveal_pii` 稽核。
- **導覽依能力**：`bootstrap` 回的能力清單決定左側顯示哪幾區（`admin/src/nav.ts`）；伺服器端 `admin-api` 仍會再擋一次。客服（回報收件匣、查詢使用者）、帳號與權限（使用者名單、管理範圍）、內容（照搬，要 `content.manage`）、系統（稽核紀錄要 `audit.read`、照搬的功能開放設定要 `settings.manage`，有其中一個就顯示這一區，分頁各自再看能力）已搬好；營運 #550 最後搬過來，搬好之前只放說明和回 App 管理分頁的連結。
- **稽核紀錄**（`#/system`）：看 `audit.admin_events`（#549）。條件：期間（24 小時／7／30／90 天／1 年）、動作、操作者、結果、來源（後台／舊管理畫面＝App 管理分頁與照搬區塊經 nlc-data 補記，前端用 `legacy` 代稱）、對象；操作者與對象放在網址（`#/system/audit?actor=…&target=…`），使用者頁有連結過來。動作的中文名稱由 admin-api 補上（`supabase/functions/admin-api/audit.ts`，新增會寫稽核的動作要一起加，`scripts/admin-api-audit.test.mjs` 會擋）。**看清單不記稽核**（只有系統管理員有 `audit.read`；每次換條件都記的話清單會被自己的查看洗掉），匯出要記。
- **新增 admin-api action**：先照 `supabase/functions/admin-api/policy.ts` 的規則加進 `ADMIN_ACTIONS`，前端再加進 `admin/src/api.ts` 的 `AdminAction`，並決定要不要快取（顯示個資、會改資料的不要）。
- **會友 App 的網域不提供後台**、後台網域也不提供會友 App：`dist/` 不會有後台檔案，`dist-admin/` 只有後台（`scripts/bundle.test.mjs`、`scripts/admin-console.test.mjs`）。照搬區塊雖然用了 App 管理分頁的程式，但只有管理畫面，沒有會友 App 的閱讀器、登入流程與 Service Worker。

## 照搬的舊管理區塊（#550）

維護者決定（2026-10-12）：重寫的只有使用者名單、權限管理、回報收件匣與所有「伺服器產生」的匯出；其他管理區塊（目前是「內容」區：公告、經文注釋、小測驗、大測驗、雲柱測驗；「系統」區的功能開放設定）**照搬、程式不動**。內容、系統兩區共用同一個 iframe，換區只是叫它打開另一個區塊；系統區上方分頁同時有新寫的稽核紀錄與照搬的功能開放設定（`tabs.ts`）。

- **畫面與程式都是 App 管理分頁那一份**：建置時從 `index.html` 抽出 `<body>`（拿掉 `<script>` 與行內事件處理器，DOM id 原樣保留），iframe 載入 `js/modules/admin.js`、`plan.js` 等同一份程式，打開哪一區交給 `openAdminSectionRoute()`。改 App 管理分頁的區塊，後台跟著改；之後 #551 拿掉 App 管理分頁時，再把這份畫面搬進 `admin-legacy/`。
- **iframe 和外殼是同網域**（`/legacy`），只有外殼能嵌（`frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`；直接打開 `/legacy` 只會看到「請從管理後台開啟」）。兩邊只靠 `MessageChannel` 溝通（`admin/src/legacy.ts` ↔ `admin-legacy/bridge.mjs`）：iframe 要 token、匯出前記稽核、回報目前這一區開不開得了、操作中（外殼延後閒置登出）；外殼送換區與主題。
- **CSP（`/legacy…`）**：腳本只允許自家與 Chart.js 固定版本的完整網址（`https://cdn.jsdelivr.net/npm/chart.js@4.5.1`，和 `js/modules/chart-loader.mjs` 同一個）；**不允許行內腳本與行內事件處理器**（App 管理區塊的按鈕都用 `addEventListener`，`index.html` 裡殘留的 `onclick=` 建置時拿掉）；樣式允許 `'unsafe-inline'`（舊畫面大量使用 style 屬性，照搬不改）；連線只允許自家與兩個 Supabase 專案；`form-action 'none'`。改 Chart.js 版本要一起改 `vercel.admin.json` 與 `scripts/build-admin.mjs` 的 `CHART_JS_URL`（建置會檢查）。
- **登入**：iframe 不登入、token 只在記憶體。它用的 `window.auth` 是 `admin-legacy/legacy-auth.mjs`，要用時向外殼要後台的 access token（與 id token；nlc-session 拿不到 Logto UserInfo 時用它確認身分，同會友 App）；外殼的登入過期就由外殼重新導向 SSO。資料照舊走 `nlc-session`／`nlc-data`／`exam-write`（三支函式的 CORS 白名單已加後台兩個網域），所以後台的 Logto scope 要有 `member:read.basic`（nlc-session 照舊同步會員中心資料），權限檢查與 #549 的稽核都在 nlc-data。注意：若之後在 Supabase 設了 `NLC_LOGTO_CLIENT_ID`，id token 的備援只收會友 App 發的，後台就只能靠 UserInfo。
- **不落地**：iframe 的 `localStorage`／`sessionStorage` 換成記憶體版、拿掉 IndexedDB，關掉分頁就沒了；不註冊 Service Worker。
- **匯出**：舊程式的下載（`<a download>` + Blob）全部被 `export-guard.mjs` 攔下，交給外殼 → `admin-api` 的 `legacy_export_audit`（需要 `export`＋該區的能力，記一筆 `export` 稽核：區塊、檔名、格式、筆數、大小）→ 成功才存檔；失敗就不下載並提示原因。認不得內容的下載一律不放行。
- **能力**：區塊 → 能力的對照有三份：`admin-legacy/sections.mjs`（iframe）、`admin/src/legacy.ts`（外殼，含分頁名稱）、`policy.ts` 的 `LEGACY_EXPORT_SECTIONS`（admin-api），`scripts/admin-legacy.test.mjs` 檢查三邊與 App 的 `ADMIN_SECTIONS` 一致。
- **只載入一次**：iframe 第一次進到照搬的區才建立，切到別區只是藏起來，回來不用再開機一次（舊程式開機要先載一輪資料）。iframe 固定高度、裡面自己捲（舊畫面的彈窗是 `position: fixed`）。
- **小測驗／大測驗**要功能開關打開才看得到（同 App）；沒開時外殼顯示說明。

## 設定（一次性，維護者操作）

### 1. Logto 應用程式（#554）

正式站、staging 各一個 SPA 應用程式：

- Redirect URI 與登出後導向都填網站根目錄：`https://bible-speed-reading-admin.vercel.app/`、`https://bible-speed-reading-admin-staging.vercel.app/`（staging 另加本機 `http://localhost:4174/`）。
- Scopes：`openid profile email member:read.basic`（`member:read.basic` 給照搬區塊經 nlc-session 同步會員中心資料），**不要** `offline_access`。resource 和會友 App 相同（`https://platform.newlife.org.tw`）。
- access token 要有標示應用程式的宣告（預設看 `client_id`，不同名稱就設 `ADMIN_API_CLIENT_CLAIM`）。

### 2. Vercel 後台專案

在同一個 Vercel team 新增專案 `bible-speed-reading-admin`（不要連 Git；部署由 CI 做）。Framework 選 Other，其他設定由 `vercel.admin.json` 決定。Deployment Protection 比照會友 App 的專案，staging 別名才打得開。

環境變數（**一般變數，不要勾 Sensitive**——Sensitive 的值 `vercel pull` 拿不到，建置會失敗）：

| 變數 | Production | Preview |
|---|---|---|
| `ADMIN_LOGTO_CLIENT_ID` | 正式站後台 client id | staging 後台 client id |
| `ADMIN_API_URL` | `https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/admin-api` | `https://dbtjsljrytzonjvclgrd.supabase.co/functions/v1/admin-api` |
| `SUPABASE_ANON_KEY` | 正式站的 anon key（和會友 App 的 Production 同一個值） | staging 的 anon key（和會友 App 的 Preview 同一個值） |

`SUPABASE_ANON_KEY` 是照搬區塊呼叫 nlc-session／nlc-data 用的（本來就是公開值）；沒設建置會失敗。

選填：`ADMIN_LOGTO_ISSUER`（預設 `https://sso.newlife.org.tw/oidc`）、`ADMIN_LOGTO_RESOURCE`（預設 `https://platform.newlife.org.tw`）、`ADMIN_LOGTO_SCOPES`（預設 `openid profile email member:read.basic`）、`ADMIN_ENVIRONMENT`（預設看 `ADMIN_API_URL` 是哪個 Supabase 專案）、`SUPABASE_URL`（預設從 `ADMIN_API_URL` 推；兩個不同專案建置會失敗）、`NLC_MEMBER_HUB_URL`（預設 `https://member.newlife.org.tw`）。

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

`.claude/launch.json` 也有同樣的 `bible-study-admin`。`ADMIN_API_URL` 沒設時用 `.env` 的 `SUPABASE_URL`，`SUPABASE_ANON_KEY` 也從 `.env` 讀。要真的登入，staging 的後台 client 要有 `http://localhost:4174/` 這個 Redirect URI，staging 的 admin-api 要設 `ADMIN_API_ALLOW_LOCALHOST=true`。本機預覽不套用 `vercel.admin.json` 的標頭，CSP 要在 staging 網址上確認（`curl -I https://bible-speed-reading-admin-staging.vercel.app/`）。
