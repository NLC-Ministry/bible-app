---
name: bible-study-dev-guidelines
description: 聖經速讀計畫專案架構規範、開發經驗與常犯 BUG 避坑指南 (Bible Study Development Guidelines & Anti-Bug Patterns)
---

# 📖 聖經速讀計畫專案開發規範與避坑指南

本技能包歸納總結自開發過程中的實戰經驗與架構設計心法，旨在避免重複犯錯、確保多人/AI pair-programming 時架構設計風格不衝突、體驗不混亂。

---

## 🛡️ 1. 安全與多租戶防禦 (Security & Multi-Tenant Defense)

* **數據過濾隔離 (Forced Scope)**：所有 Edge Function (`supabase/functions/nlc-data`) 與 DB Trigger/RPC，對寫入、更新與刪除操作必須具備硬性 `user_id` 與 `plan_id` 權限過濾限制（例如 `applyForcedScope`）。
* **嚴禁跨帳號越權**：重置個人進度或切換遍數時，絕對不能使用無過濾條件的全表操作，防止誤刪他人資料。

---

## 🔄 2. UI 狀態與滾動記憶 (Scroll State Preservation)

* **容器重繪記憶 (Scrolltop Preservation)**：
  - 當調用重繪 DOM 容器（例如 `renderHorizontalDateStrip()`，即 `innerHTML = ""`）前，**必須先記錄 `.calendar-scroll-container` 的 `scrollTop` 與 `scrollLeft`**。
  - DOM 重新渲染完成後，立即還原原滾動位置，確保使用者打卡無縫不跳動。
* **平滑滾動取代視窗大跳**：
  - 避免直接呼叫會造成整頁大跳的原生 `scrollIntoView()`。
  - 滾動至目標天數或經文時，優先以 `requestAnimationFrame` 配合容器內區域平滑置中。
* **新的全螢幕 `position: fixed` 疊層，絕對不要放在 `.view-pane` 內部**：
  - `.view-pane` 有 `animation: fadeIn 0.4s ease-out forwards;`，`forwards` fill mode 讓動畫結束後元素仍保留最後一個 keyframe 的 `transform: translateY(0)`——即使視覺上看起來等於沒有位移，**任何非 `none` 的 `transform` 值都會讓該元素變成子孫 `position: fixed` 元素的新 containing block**。
  - 後果：巢狀在 `#reader-view`（帶有 `class="view-pane"`）底下的 `position: fixed` 疊層，會被錯誤地定位/裁切在 `#reader-view` 自己的框內，而不是真正的視窗——導致疊層的頂部被外層 App chrome（例如 reader 自己的頂部導覽列）蓋住或看起來「關閉鍵消失」。這個 bug 這個 session 實際發生過一次（逐節筆記全螢幕編輯框）。
  - **正確做法**：比照 `#bible-nav-overlay`（目錄／版本選擇）、搜尋面板等既有全螢幕疊層的做法，把新疊層的掛載節點放在 `.view-pane` 之外、`<body>` 的頂層（例如緊鄰 `#bible-nav-overlay` 旁邊），不要塞進任何 tab/view 的內部結構。

---

## 🔒 3. 非同步競態條件與 Session 序號鎖 (Async Race-Condition & Session Counter)

* **瀏覽器 API 鬼影事件 (Cancel Event Ghosting)**：
  - 在 Web Speech API / TTS 語音播放中，呼叫 `window.speechSynthesis.cancel()` 停止播放時，瀏覽器仍會延遲非同步觸發上一會話的 `onend` 或 `onerror` 事件。
* **世代序號鎖 (Generation Counter)**：
  - 引入全域 `currentAudioSessionId`！
  - 每次停止或開啟新播報時將 `currentAudioSessionId` 遞增。
  - 在所有非同步回調 (`onend`, `onerror`, `setTimeout`) 中，檢查 `if (sessionId !== currentAudioSessionId) return;` 強制銷毀過期事件，達到**隨點隨停、不狂刷**。

---

## 🎙️ 4. 真人高質感音質與多譯本聯動 (Natural Neural Speech & Multi-Lang)

* **消除 AI 機械感 (Natural Neural Voice Selector)**：
  - `selectPreferredVoice(voices, lang)` 權重比對中，優先指派含有 `Natural` (自然), `Neural` (神經網路音色), `Online`, `Ting-Ting`, `Samantha`, `HsiaoChen`, `YunJhe` 等真人高品質標籤。
  - 排除 `compact`, `espeak` 等單薄傳統機械聲。
* **譯本語言自動聯動**：
  - 切換至中文譯本 (`CUNP`, `RCUV`, `CUV`) 時，TTS 自動指派 `zh-TW` 真人聲。
  - 切換至英文譯本 (`ESV`, `NIV`, `NLT`) 時，TTS 自動切換至 `en-US` / `en-GB` 英文真人聲。

---

## 🎨 5. 人性化 UI/UX 互動規範 (User-First Design Rules)

* **深色模式對比度與 Modal 按鈕規範 (Dark Theme Contrast & Modals)**：
  - 彈窗 Modal (如 `#bible-version-picker-modal`) 在 Dark Theme 下，按鈕預設背景**嚴禁為純白全顯狀態 (`background: #fff`)**。
  - 應繼承主題變數 `background: var(--bg-surface, rgba(255, 255, 255, 0.05)) !important` 與 `color: var(--text-primary, #f8fafc) !important`，確保白字高清可讀、無白底融化文字狀況。
* **極致高質感懸浮毛玻璃膠囊列 (Floating Capsule Selection Bar)**：
  - **Shadcn / Glassmorphism Container**：極簡圓角膠囊形狀 (`rounded-full`)，懸浮於螢幕底部 16px 處，樣式 `bg-background/80 backdrop-blur-md border border-white/10 shadow-2xl`。
  - **莫蘭迪柔和螢光色調 (Morandi Swatches)**：採用 **柔黃 (`#fef08a`)、柔藍 (`#a5f3fc`)、柔綠 (`#bbf7d0`)、柔橘粉 (`#fed7aa`)** 莫蘭迪半透明柔和色系，選中帶有 `ring-2 ring-primary ring-offset-2` 外環。
  - **Cascader & Divided Actions**：中間配置優雅垂直分隔線 (`h-5 w-[1px] bg-border/50`)，右側精簡聚焦 3 大 Ghost Button 核心功能（▶️ 朗讀 | 📋 複製 | 📤 分享）。
  - **純淨極簡 (Ultra Pure)**：完全移除拉桿與「向上滑動查看更多」等多餘提示文字，保持畫面 100% 俐落美觀。
* **安靜自動打卡 (Silent Auto-Read)**：
  - 滑到底部自動已讀時，保持靜默打卡，不彈出干擾閱讀視覺的 Toast 與確認彈窗對話框。
* **記憶體與 UI 即時同步 (Instant State Reactivity)**：
  - 打卡日誌更新時，同步更新記憶體中 `state.activePlan` 物件屬性 (`ch.isRead`, `ch.isReadR1` 等)。
  - 返回進度頁面時觸發 `calculatePlanProgress()` 與 DOM 重繪，**無需手動重新整理/更新頁面，即時呈現勾選已讀**。

---

## 🗄️ 6. 嚴格 Database Migration Schema 全局對齊規範 (Database Migration Integrity Rule)

* **修改 Edge Function / RPC 前必須完整檢視 Migration 歷史**：
  - 在修改 `supabase/functions/` (如 `nlc-data`) 或撰寫 Supabase 查詢時，**絕對禁止憑空猜測或使用已廢棄的舊資料架構欄位**（例如 `profiles.role` 欄位已在 Migration `0048` 被 `DROP COLUMN` 刪除，全站統一改用 `role_id` 關聯 `role_definitions`）。
  - **開工前第一步**：修改 Edge Function 或 DB 查詢前，必須先掃描 `supabase/migrations/` 中最新的 SQL Schema 檔案（如 `0048`, `0054`），確認請求的所有欄位在資料庫中均為真實存在的實體欄位。
* **防止無效 PostgREST 查詢與 Edge Function 500 崩潰**：
  - 嚴禁請求已被刪除的舊欄位或非實體 Column（如 `role_code` 為 SQL 函數，非 `profiles` 表實體欄位）。
  - 所有 Edge Function 內部對 Supabase 的查詢必須配置強固的 Try-Catch / Fallback 容錯備援，確保縱使外鍵關聯遇到異常，亦能降級處理，絕不讓 Edge Function 拋出未捕獲例外導致 HTTP 500 伺服器崩潰。
* **⚠️ 陷阱：有些 migration 是用「動態文字替換」修補之前的 function，不是乾淨重寫**：
  - `0047`/`0048`/`0063` 對 `get_unjoined_plan_members`、`send_plan_join_invitation`、`get_reading_team_registration_overview` 等 function 用的是 `pg_get_functiondef(...)` 撈出**目前資料庫裡實際部署的版本**，`REPLACE()` 特定文字片段，再 `EXECUTE` 回去——不是重新 `CREATE OR REPLACE FUNCTION` 貼上完整新版本。
  - **後果**：像 `0045_plan_join_encouragement.sql` 這種原始 migration 檔案裡的 `actor_profile.role`，讀檔案看起來像是還在用已刪除的舊欄位，但實際上 `0048` 已經把「線上運行的版本」動態改成 `actor_profile.role_code`。**只看單一 migration 檔案的原始碼，不能判斷這個 function 現在的真實內容**——要嘛把所有動態補丁 migration 依序在腦中套用一次，要嘛直接去 Supabase Dashboard 查詢 `pg_get_functiondef` 的當前結果，不要憑 `grep` 單一檔案就下結論。
  - 之後新寫一支 function 若要仿照舊 function 的邏輯，**直接寫全新的 `CREATE OR REPLACE FUNCTION`**（像 `0070`/`0073`/`0074` 那樣用當前正確的 `role_code(role_id)` + `values_overlap()` pattern），不要照抄舊 migration 檔案裡的原始文字。
* **`reading_team_members` 沒有 `id` 欄位**：主鍵是 `(team_id, user_id)` 組合鍵（`0019`）。這個 bug 在同一個 session 裡至少踩到兩次、分散在不同的 function（`get_admin_member_team_placements` 的 `membership.id`、`db.js` 裡兩個獨立的 fallback 查詢）。改動任何碰這張表的程式碼前，先 `grep "reading_team_members" -A5` 確認 select/reference 的欄位都是真的存在的（`team_id`, `global_plan_id`, `user_id`, `member_role`, `division`, `joined_at`），不要選 `id`。
* **`managed_regions` / `managed_zones` / `managed_groups` 是 `NOT NULL DEFAULT ''`，不是可為 NULL**：
  - 這三個委任範圍欄位（`0011`）永遠是空字串、不會是 SQL NULL。用 `COALESCE(managed_x, 個人欄位, '')` **抓不到「已設定但是空字串」的情況**，一定要用 `COALESCE(NULLIF(managed_x, ''), 個人欄位, '')`。
  - 這個 bug 這個 session 至少在 3 支不同的 function 裡各自重複出現過（`get_admin_member_team_placements`、`get_reading_team_registration_overview`、`js/db.js` 的 `updateManagedScopes`），每次都是「委任範圍空字串被誤判成『無限制』，導致權限過度開放」或「寫入 NULL 觸發 NOT NULL constraint 直接 400」兩種後果之一。
* **`nlc-data` 用 service-role key 執行，正式環境（NLC Logto SSO）完全繞過 RLS**：
  - Migration 裡定義的 RLS policy（例如 `reading_teams_own_team_read`）只保護「直接用 Supabase client 連線」的情境（Google/email 開發登入）；正式環境走 `nlc-data` Edge Function 用 service-role key 查詢，RLS 對它完全不生效。
  - **任何透過 `action: "select"` 泛用查詢暴露出去的表，都必須自己在 `applyForcedScope()` 裡手動加範圍限制**，不能假設資料庫層的 RLS 會擋。忘記加的話，一般會友理論上可以查到全教會的資料（例如曾經發生過的 `reading_teams`/`reading_team_members` 無範圍限制事件）。

---

## 🧪 7. 測試、部署與工作流程避坑 (Testing, Deployment & Workflow)

* **`scripts/*.test.mjs` 是「原始碼文字斷言」風格，不是真的單元/整合測試**：
  - 這些測試多半是把檔案當字串讀進來，斷言某段 regex/子字串存在或不存在，有時會用 `new Function(...)` 把抽取出來的函式片段組出來直接執行驗證邏輯。
  - **後果：測試通過不代表行為正確，只代表「程式碼文字長得像測試預期的樣子」**。如果測試是照著一支有 bug 的程式寫的，它反而會把那個 bug「鎖死」，之後任何修正都會被舊測試打成 fail。
  - **實際發生過的誤判案例**：`scripts/management-plan-hub.test.mjs` / `scripts/management-unjoined-plan-members.test.mjs` 斷言 `getManagementPlans()`/`selectManagementPlan()` 要優先選 `stageOnePlan`；但 `admin.js` 現在的行為是優先選 `ongoingPlan`（正確、刻意的新設計）。一開始誤判成「這是不小心的 regression」，還花時間把 `admin.js` 改回舊行為，後來才發現有一支**更新的**測試檔 `scripts/admin-ongoing-plan-selection.test.mjs` 明確記載「移除 hardcoded stageOnePlan、改用 ongoing plan 優先」才是刻意設計。最後用 `git diff` 確認把 `admin.js` 完整還原（diff 為零）並改掉那兩支舊測試才是對的。
  - **規則**：發現某支測試 fail、看起來像「這改動造成了 regression」時，先搜尋同一個函式/功能是否有**其他、更新的**測試檔案已經記載了刻意的新行為，不要只看到 fail 就假設現在的程式碼是錯的。
* **CSS cache-bust：`npm run bump` 不會碰 `index.html` 裡的 `index.css?v=` 或 `css/*.css?v=`**：
  - `scripts/bump-version.mjs` 只更新 `js/app.js` 內部 static import 的 `?v=...` 版本字串，以及 `index.html` 裡 `js/app.js?v=` 那一行。
  - **改到 `index.css` 或 `css/` 底下任何檔案時，必須手動去 `index.html` 把對應的 `?v=` 字串加一版**，不要以為跑了 `npm run bump` 就全部處理好了。
* **Supabase migration 檔案不會自動部署**：
  - 這個 repo 的 git commit/push 只影響前端程式碼；`supabase/migrations/*.sql` 必須由使用者另外手動執行 `supabase db push` 或貼到 Supabase Dashboard 的 SQL Editor 才會真正生效。
  - **每次新增/修改 migration 檔案後，一定要明確提醒使用者「這支 migration 還沒部署，要記得手動跑」**，不要預設寫了檔案 = 資料庫已經改好了。這個 session 曾經一次累積到 5 支 migration（`0070`–`0074`）等待部署，容易忘記追蹤。
* **使用者回報 bug 時，優先要求或引用瀏覽器 Network 分頁的實際 request/response payload，不要憑錯誤訊息猜**：
  - 這個 session 好幾次 400/42703/42883/P0001 錯誤，都是因為先憑經驗猜錯方向，直到使用者貼出實際的 payload/response 內容才找到真正原因（例如 `reading_team_members` 沒有 `id` 欄位、`values_overlap` 函式不存在、`get_admin_member_team_placements` 的 `p_actor_id` 沒有被注入）。
  - 精確的錯誤文字（尤其是 Postgres error code 與欄位/函式名稱）比猜測快非常多，遇到 400 系列錯誤時應主動請使用者提供完整 payload/response 而不是只憑 stack trace 頂端那一行猜。
