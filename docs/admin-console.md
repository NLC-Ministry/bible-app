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
- `admin-legacy/`：照搬區塊的 iframe 頁（`/legacy`）。`admin-view.html` 是舊管理分頁＋全域計畫管理卡片的畫面（#551 從 `index.html` 搬來）；`legacy-entry.js` 載入舊管理分頁的程式；`globals.js`（全域設定，一定第一個 import）、`legacy-auth.mjs`（取代 `js/auth.js`，token 向外殼要）、`memory-storage.mjs`、`export-guard.mjs`、`bridge.mjs`、`sections.mjs`、`legacy.css`（藏掉 App 外框）。
- `scripts/build-admin.mjs`：建置到 `dist-admin/`：外殼（`index.html`、`admin.<hash>.js`、`admin.<hash>.css`、`favicon.svg`、`robots.txt`）和照搬區塊（`legacy.html`、`legacy.<hash>.js`、`legacy.<hash>.css`、`assets/`）。
- `vercel.admin.json`：後台專案的 Vercel 設定（建置指令、輸出目錄、安全標頭）。CI 部署後台時把它複製成 `vercel.json`。
- `js/admin-console-link.mjs`：會友 App 連到後台的固定網址（回報管理的「在後台查看此使用者」）。

## 規則

- **安全標頭直接強制**（不走觀察模式）：外殼（`/legacy` 以外的路徑）CSP `default-src 'none'`；腳本、樣式只允許自家；連線只允許兩個 Supabase 專案（admin-api）和 Logto；圖片允許自家、`data:`、Supabase Storage；`frame-src 'self'`（只嵌自己的 `/legacy`）、`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'self'`、`object-src 'none'`、`X-Frame-Options: DENY`。照搬區塊（`/legacy…`）另一份，見下面。加 `X-Robots-Tag: noindex`，HTML 回 `Cache-Control: no-store`。
- **不寫行內腳本、行內 style、`dangerouslySetInnerHTML`**。React 的 `style={…}` 也不用（測試會擋）；會友輸入的內容一律當文字顯示。
- **token 只放記憶體**，沒有 refresh token（scope 不含 `offline_access`）。過期或重新整理就重新導向 SSO（Logto 已登入時不用再輸入密碼）。sessionStorage 只放 PKCE 這一趟的一次性資料與「剛登出」旗標；localStorage 只放主題偏好；不用 IndexedDB、cookie、Service Worker。
- **閒置 30 分鐘自動登出**，並結束 Logto 的登入狀態（只清記憶體的話，重新整理又會無聲登回來）。登出前 1 分鐘提醒。
- **請求預算**：開後台＝`bootstrap`＋預設頁（回報收件匣）的 1 個 `report_list`（第一頁順便帶各狀態筆數）；打開一張回報只打 1 個 `report_thread`，之後畫面在前景時每 20 秒自動更新（`refresh: true`，不重複記稽核）；診斷資訊展開才打 `report_diagnostics`。收件匣清單放在客服區那一層，切到「查詢使用者」再回來不重抓。打開某人只打 1 個（`user_summary`，裡面已有各區塊最新 5 筆與總數）；「載入更多」才打 `user_section`，切到時間軸才打 `user_timeline`。記憶體快取 60 秒，同一個人切換區塊不重抓。使用者名單：打開 1 個 `directory_list`（第一頁順便帶計畫選項與預設計畫），改條件 1 個（搜尋字停 300ms 才送），「載入更多」1 個；管理範圍：打開 1 個 `scope_overview`（組織名單用 `bootstrap` 帶的），點某位負責人不再打，儲存 1 個 `scope_set`、成功後就地更新。兩個分頁的資料放在帳號區那一層，切分頁再回來不重抓。稽核紀錄：打開 1 個 `audit_list`（第一頁順便帶總數與「動作」「操作者」選項），改條件 1 個，「載入更多」1 個；點開一筆不再打（清單已帶變更內容），只有內容太大被省略的那筆打 1 個 `audit_event`；`audit_list` 快取 60 秒，切到功能開放設定再回來不重抓（重新整理鈕不用快取）。測試：`admin/__tests__/request-budget.test.tsx`、`report-inbox.test.tsx`、`accounts.test.tsx`、`audit.test.tsx`。
- **計畫總覽／名單的資料**（#564，要 `plans.read`）：`plan_summary` 只有數字（漏斗、進度與最後打卡兩個條件各格人數、需要關心分原因、單位比較、今天的日程），不記稽核；`plan_roster` 一次載完範圍內每人一列（不帶 email，前端展開、篩選、排序都不再發請求），伺服器記 `view_plan_roster`。每個人的狀態由伺服器執行和 App 同一份規則（`supabase/functions/_shared/progress`），前端不要再算一次。兩個都進 `api.ts` 的快取；回應的 `meta.consistent` 是 false（SQL 另外數的人數和名單對不上）時畫面要警告並 invalidate。
- **「計畫」區**（#565，`admin/src/views/PlanArea.tsx`、`admin/src/plans.ts`，導覽要 `plans.read`）：上面選一次計畫（`plan_options`：隱藏的與總表不列，預設＝進行中→還沒開始→已結束），下面分頁 總覽／名單／團隊／測驗作答／計畫設定。請求預算：打開＝`plan_options`＋`plan_summary`；名單打開才載 `plan_roster`（展開、篩選、排序、搜尋都不再發請求）；測驗作答打開才載 `plan_quiz`；團隊分頁上面是總覽的數字（報名者組隊），下面的隊伍清單打開才載 `team_list`（篩選、搜尋不再發請求）。選的計畫、名單與隊伍清單的條件放在 `App` 那一層，切到計畫設定或別區再回來還在。
- **隊伍除錯**（#566，`admin/src/views/TeamPage.tsx`、`admin/src/teams.ts`，要 `plans.read`；第一階段只讀，修正動作是 #571）：沒有自己的選單，入口是計畫 → 團隊（點一隊）、查詢使用者（同一個字也找隊名或邀請碼，結果寫是哪個計畫）、個人頁的團隊欄與團隊異動。網址 `#/plans/teams/<team_id>[?plan=]`。`team_list` 一次拿齊這個計畫每一隊＋伺服器跑的除錯檢查（記 `view_plan_teams`），格子是 隊伍／還沒滿／有異常，篩選 全部／還沒滿／有異常。隊伍頁打開＝1 個 `team_detail`（記 `view_team`）：基本資料（已結束的階段標「不能修改」）、除錯檢查（狀態和人數、人數上限、隊長、成員有報名、同計畫同組別不重複、階段結束後沒有異動；沒過的寫影響和怎麼修）、「會友 App 應該顯示」（隊伍進度、邀請碼、帶隊按鈕與原因）、成員（加入方式從 `call_context` 推）。異動歷程（`team_history`，白話＋工程細節切換；0149 部署前沒有紀錄）與跨階段對應（`team_lineage`，沿 `carried_from_team_id`；被略過的人是**推斷**的，帶隊結果沒有存）點開才載。檢查與「會友 App 應該顯示」都由伺服器執行和 App 同一份規則（`_shared/progress/team-report.mjs`、`team-progress.mjs`、`campaign-stage-kinds.mjs`；App 的舊路徑只是 re-export），前端不要再算。`jwt_claims` 永遠不回。營運區的「組隊狀況」暫時保留（隊伍與成員名單的 CSV 匯出還在那裡）。測試：`scripts/team-debug.test.mjs`、`admin/__tests__/teams.test.tsx`。
  - **名單規則只有一份**：篩選（「進度」「最後打卡」兩個條件，同一條件內聯集、條件之間交集，加團隊）、排序（預設落後天數多→少）、從漏斗／需要關心點進來的條件，都在 `_shared/progress/plan-report.mjs`，後台畫面和伺服器匯出（`plan_roster_export`，伺服器重算、不帶 email、記一筆 `export`、記不成就不回檔案）用同一份，所以點進來的人數一定等於總覽的數字（`scripts/plan-area.test.mjs` 對帳）。後台只准 import `_shared/progress` 的這兩個檔（`scripts/admin-console.test.mjs`）。
  - **關心提醒**（`care_remind`，能力 `plans.remind`）：原因與預設內容同 App 的關心對話框；寄件人在 App 顯示「系統管理員」。同一位寄件人對同一人同一計畫一天一則，送出後不能改（`enforce_care_reminder_transition`），今天已送過就回 `care_reminder_already_sent`；稽核 `care_reminder.send` 在 SQL 同一個交易。`plan_key` 由伺服器從計畫推出（和 App 的 `presetKey || globalPlanId` 相同）。
  - **測驗作答**（`plan_quiz`，只有數字、不記稽核）：這期沒設定的測驗不顯示；功能開放設定關閉時只留一行小字；載入失敗一定顯示錯誤。雲柱不屬於任何計畫，只算計畫期間出的題、這期報名者的作答，連到「內容 → 雲柱測驗」。
  - 長條圖用 SVG 屬性畫（CSP 不允許行內 style）。
- **會改資料的動作要 `support.write`**（回覆、內部備註、改狀態、刪截圖、刪回報），沒有這個能力的帳號看不到輸入框和按鈕；伺服器端在同一個交易內寫稽核。刪回報要再確認一次，可填原因（記進稽核）。
- **帳號與權限**：看名單、管理範圍要 `accounts.read`，改管理範圍要 `accounts.write`（沒有的話勾選框停用、沒有儲存鈕）。名單在伺服器端篩選、分頁（一次 50 人、email 遮罩），不像 App 一次把全部的人和完整 email 載進瀏覽器。**角色由會員中心同步，後台不改角色**；只改大區長／區長／小組長的管理範圍（`set_profile_managed_scopes`，名稱要在組織名單裡），可填修改原因，稽核記前後差異。
- **匯出一律由伺服器產生**（`report_export` 需要 `support.read`＋`export`；含完整 email 的 `directory_export` 需要 `accounts.read`＋`export`＋`support.pii`；`org_export` 需要 `accounts.read`＋`export`；`audit_export` 需要 `audit.read`＋`export`、最多 5000 筆；都記 `export` 稽核，欄位和 App 的匯出相同）；前端只存檔，不自己組 CSV。照搬區塊的匯出是例外（舊程式在瀏覽器組檔），但下載前一定先成功呼叫 `legacy_export_audit` 記稽核，記不到就不下載（見下面）。
- **截圖**：回覆可附 1 張（瀏覽器先壓到約 300 KB，伺服器上限 500 KB，PNG／JPEG／WebP）。顯示用 5 分鐘有效的簽名網址，存檔路徑不送到前端。
- **個資預設遮罩**：按「顯示」才呼叫 `reveal_pii`（伺服器記稽核，需要 `support.pii` 能力）。可以附上查看理由，會記進 `view_user`／`reveal_pii` 稽核。
- **導覽依能力**：`bootstrap` 回的能力清單決定左側顯示哪幾區（`admin/src/nav.ts`）；伺服器端 `admin-api` 仍會再擋一次。客服（回報收件匣、查詢使用者）、帳號與權限（使用者名單、管理範圍）、計畫（#565，要 `plans.read`；「計畫設定」分頁另外要 `operations.manage`）、營運（照搬，要 `operations.manage`）、內容（照搬，要 `content.manage`）、系統（稽核紀錄要 `audit.read`、照搬的功能開放設定要 `settings.manage`，有其中一個就顯示這一區，分頁各自再看能力）。#550 之後五區都已搬好，App 管理分頁的功能後台都有（App 的管理分頁由 #551 拿掉）。
- **稽核紀錄**（`#/system`）：看 `audit.admin_events`（#549）。條件：期間（24 小時／7／30／90 天／1 年）、動作、操作者、結果、來源（後台／舊管理畫面＝App 管理分頁與照搬區塊經 nlc-data 補記，前端用 `legacy` 代稱）、對象；操作者與對象放在網址（`#/system/audit?actor=…&target=…`），使用者頁有連結過來。動作的中文名稱由 admin-api 補上（`supabase/functions/admin-api/audit.ts`，新增會寫稽核的動作要一起加，`scripts/admin-api-audit.test.mjs` 會擋）。**看清單不記稽核**（只有系統管理員有 `audit.read`；每次換條件都記的話清單會被自己的查看洗掉），匯出要記。
- **新增 admin-api action**：先照 `supabase/functions/admin-api/policy.ts` 的規則加進 `ADMIN_ACTIONS`，前端再加進 `admin/src/api.ts` 的 `AdminAction`，並決定要不要快取（顯示個資、會改資料的不要）。
- **會友 App 的網域不提供後台**、後台網域也不提供會友 App：`dist/` 不會有後台檔案，`dist-admin/` 只有後台（`scripts/bundle.test.mjs`、`scripts/admin-console.test.mjs`）。照搬區塊雖然用了 App 管理分頁的程式，但只有管理畫面，沒有會友 App 的閱讀器、登入流程與 Service Worker。

## 照搬的舊管理區塊（#550）

維護者決定（2026-10-12）：重寫的只有使用者名單、權限管理、回報收件匣與所有「伺服器產生」的匯出；其他管理區塊**照搬、程式不動**：「營運」區（組隊狀況、讀經使用率、報名註冊統計；計畫管理 #565 起是「計畫」區的「計畫設定」分頁，加入計畫狀況、組員總覽、計畫統計由計畫區的總覽與名單取代、已移除，舊網址導到新頁）、「內容」區（公告、經文注釋、小測驗、大測驗、雲柱測驗）、「系統」區的功能開放設定。三區共用同一個 iframe，換區只是叫它打開另一個區塊；系統區上方分頁同時有新寫的稽核紀錄與照搬的功能開放設定（`tabs.ts`）。

- **畫面**：建置時取 `index.html`，把 `<!-- admin-view:start -->`～`<!-- admin-view:end -->` 那段（App 的新管理分頁，#551）換成 `admin-legacy/admin-view.html`（舊管理分頁＋計畫管理卡片），再抽出 `<body>`（拿掉 `<script>` 與行內事件處理器，DOM id 原樣保留）。組合在 `scripts/lib/legacy-markup.mjs`（兩個標記不是各一個就建置失敗）；舊管理區塊的測試用它的 `readLegacyIndexHtml()` 讀同一份畫面。`index.html` 其他地方仍有舊程式要用的元素（計畫分頁裡的共用統計容器 `#plan-org-stats-subview`、直接放在 body 底下的雲柱測驗面板，#420），跟著 App 一起抽出來。
- **程式**：iframe 載入 `js/modules/admin.js`、`plan.js`、`campaign-rule-editor.js` 等舊程式，打開哪一區交給 `openAdminSectionRoute()`。會友 App 從 #551 起不再載入這些（`scripts/bundle.test.mjs` 檢查 `dist/` 沒有這幾個 chunk）。
- **計畫管理**：原本是讀經計畫分頁側欄的「全域計畫管理」卡片（`#admin-plan-card`，程式在 `js/modules/plan-admin.js`，含大區延後梯次與教會活動規則編輯器），#551 起只在 `admin-view.html`。iframe 開機時建一個同格式的區塊面板 `admin-section-plans`，把卡片搬進去（`admin-legacy/sections.mjs` 的 `LEGACY_HOSTED_CARDS`）；打開時只給系統管理員、這時才載入 `plan-admin.js`。直接從計畫管理開機時，舊程式「還原上次選的功能」改記公告，免得退回第一個區塊（使用者基本資料）去載整份名單。
- **iframe 和外殼是同網域**（`/legacy`），只有外殼能嵌（`frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`；直接打開 `/legacy` 只會看到「請從管理後台開啟」）。兩邊只靠 `MessageChannel` 溝通（`admin/src/legacy.ts` ↔ `admin-legacy/bridge.mjs`）：iframe 要 token、匯出前記稽核、回報目前這一區開不開得了、操作中（外殼延後閒置登出）；外殼送換區與主題。
- **CSP（`/legacy…`）**：腳本只允許自家與 Chart.js 固定版本的完整網址（`https://cdn.jsdelivr.net/npm/chart.js@4.5.1`，和 `js/modules/chart-loader.mjs` 同一個）；**不允許行內腳本與行內事件處理器**（App 管理區塊的按鈕都用 `addEventListener`，`index.html` 裡殘留的 `onclick=` 建置時拿掉）；樣式允許 `'unsafe-inline'`（舊畫面大量使用 style 屬性，照搬不改）；連線只允許自家與兩個 Supabase 專案；`form-action 'none'`。改 Chart.js 版本要一起改 `vercel.admin.json` 與 `scripts/build-admin.mjs` 的 `CHART_JS_URL`（建置會檢查）。
- **登入**：iframe 不登入、token 只在記憶體。它用的 `window.auth` 是 `admin-legacy/legacy-auth.mjs`，要用時向外殼要後台的 access token（與 id token；nlc-session 拿不到 Logto UserInfo 時用它確認身分，同會友 App）；外殼的登入過期就由外殼重新導向 SSO。資料照舊走 `nlc-session`／`nlc-data`／`exam-write`（三支函式的 CORS 白名單已加後台兩個網域），所以後台的 Logto scope 要有 `member:read.basic`（nlc-session 照舊同步會員中心資料），權限檢查與 #549 的稽核都在 nlc-data。注意：若之後在 Supabase 設了 `NLC_LOGTO_CLIENT_ID`，id token 的備援只收會友 App 發的，後台就只能靠 UserInfo。
- **不落地**：iframe 的 `localStorage`／`sessionStorage` 換成記憶體版、拿掉 IndexedDB，關掉分頁就沒了；不註冊 Service Worker。
- **匯出**：舊程式的下載（`<a download>` + Blob）全部被 `export-guard.mjs` 攔下，交給外殼 → `admin-api` 的 `legacy_export_audit`（需要 `export`＋該區的能力，記一筆 `export` 稽核：區塊、檔名、格式、筆數、大小）→ 成功才存檔；失敗就不下載並提示原因。認不得內容的下載一律不放行。
- **能力**：區塊 → 能力的對照有三份：`admin-legacy/sections.mjs`（iframe）、`admin/src/legacy.ts`（外殼，含分頁名稱）、`policy.ts` 的 `LEGACY_EXPORT_SECTIONS`（admin-api），`scripts/admin-legacy.test.mjs` 檢查三邊與 App 的 `ADMIN_SECTIONS` 一致（計畫管理例外，檢查的是 `#admin-plan-card`）；稽核紀錄裡的區塊名稱在 `supabase/functions/admin-api/audit.ts` 的 `AUDIT_LEGACY_SECTION_LABEL`（`scripts/admin-api-audit.test.mjs` 比對；移除的區塊名稱留在 `RETIRED_LEGACY_SECTIONS`，舊的匯出紀錄才看得懂）。`operations.manage`、`content.manage`、`settings.manage` 都只有系統管理員有：App 管理分頁的加入計畫狀況、組員總覽、組隊狀況、計畫統計、小測驗、大測驗也開給牧者與各層小組長（看自己管理範圍的資料），但組長不進後台（維護者 2026-10-11 定案），他們的部分留在 App 的管理分頁，#551 重做成總覽／名單／團隊／測驗四個分頁（`js/modules/pastoral.js`，資料是 `get_pastoral_overview`）。App 的舊網址 `#/admin/<系統管理區塊>` 會把系統管理員導到後台對應的頁面（`js/admin-console-link.mjs` 的 `ADMIN_CONSOLE_SECTION_ROUTES`，`scripts/admin-console-link.test.mjs` 檢查每個目標都是後台真的有的頁面）；個人頁有系統管理員才看得到的「開啟管理後台」。
- **只載入一次**：iframe 第一次進到照搬的區才建立，切到別區只是藏起來，回來不用再開機一次（舊程式開機要先載一輪資料）。iframe 固定高度、裡面自己捲（舊畫面的彈窗是 `position: fixed`）。
- **小測驗／大測驗**要功能開關打開才看得到（同 App）；沒開時外殼顯示說明。其他區塊開不了只會是會友 App 的角色看不到（外殼的說明見 `legacy.ts` 的 `unavailableHint()`）。

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
