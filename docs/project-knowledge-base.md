# 專案知識庫：核心邏輯、背景與規範總覽

> **這份文件是什麼**：把這個專案自開發以來、透過歷次 AI 協作 session 累積的背景知識、已拍板的設計決策、踩過的坑與規範，整理成一份可以被 git 追蹤、跨裝置/跨協作者共讀的文件。目的是讓任何人（或任何一個全新開始的 AI 助理）在接手這個 repo 時，能快速知道「這裡發生過什麼事、為什麼會長成現在這樣、有哪些雷不要再踩」，不用每次都重新踩一次坑或重新溝通一次已經定案的設計。
>
> **資訊新鮮度警語**：本文件內容整理自歷次對話留下的工作記憶，是**時間點快照**，不是即時資料庫狀態。特別是「未部署」的標記，可能在整理當下已經被使用者部署完成、只是沒有回頭更新記錄。**任何「未部署」「待辦」的描述，使用前務必先用 `git log` / 直接查 Supabase 現況核實，不要盲目相信文件說的還沒做。** 本文件寫成當下，`supabase/migrations/` 最新的檔案是 `0191_normalize_placeholder_org_unit_names.sql`；`0173`–`0189` 這段（安全性 REVOKE 掃描、每日小測驗五題型、排行榜/PR 公布）是本文件整理者記憶快照**之後**才發生的既成事實，細節請直接看那些 migration 檔案與對應的 git commit/PR，本文件不重複描述。
>
> 更完整的架構規範見同倉庫的 [`CLAUDE.md`](../CLAUDE.md) 與 `.claude/skills/bible-study-dev-guidelines/SKILL.md`；本文件著重在「發生過的事、為什麼這樣設計、學到的教訓」，跟 CLAUDE.md 的「現況架構說明」互補，不重複貼原文。

---

## 一、專案核心目標與背景

**新生命聖經速讀計畫**（NewLife Bible Speed Reading）是一個繁體中文 PWA，服務教會的季度讀經挑戰活動：讀經打卡、多種計畫類型、個人/團隊/牧區統計、排行榜、遊戲化徽章、靈修筆記。它是 NewLife Member Hub 的**衛星應用**，透過 NLC（紟道）生態系的 Logto SSO 整合會員資料。

**技術棧**：主要分頁（首頁/聖經閱讀器/計畫/系統管理/個人）是原生 JS/HTML/CSS，無框架、開發環境無 bundler；正式環境跑 `esbuild --bundle --minify` 真實建置流程。唯一的例外是「問題回報」功能，是一個獨立的 React + TypeScript island，打包成自己的 lazy chunk。後端是 Supabase（Postgres + Edge Functions），部署在 Vercel。

**關鍵架構事實**（決定了很多後續設計為什麼長這樣）：

1. **雙客戶端 shim（`js/db.js`）**：`state.supabase` 在執行期是「真的 Supabase client」（Google/email 登入，只在 dev/localhost）或「`NlcDataClient` shim」（NLC Logto SSO，正式環境），兩者暴露相同的 `.from(table).select()...` 鏈式 API。**正式環境一律走 shim**，shim 把查詢序列化成 JSON POST 給 `nlc-data` Edge Function，該 function 用 **service-role key**（繞過 RLS）處理。這個事實直接導致：
   - `applyForcedScope()` 是正式環境**唯一的**存取控制，RLS policy 在正式環境形同虛設（見下方規範章節）。
   - 每一次 `.from().select()` 呼叫在正式環境都是一次獨立的 HTTP round-trip + 一次 Logto token 驗證——這後來成為效能優化的主要目標（見「效能與網路優化」章節）。
2. **四個獨立入口點**：`index.html`→`app.js`（主 SPA）、`exam.html`→`exam-entry.js`（大測驗獨立頁）、`grade.html`→`grade-entry.js`（線上批改獨立頁）、`repair.html`（快取修復用靜態頁）。三個「真」入口各自重複一段固定順序的核心檔案 side-effect import 鏈。
3. **激進的快取破壞機制**：因為使用者主要透過手機 PWA 使用，app 對抗快取非常小心——核心檔案用手動 `?v=YYYYMMDD_label`、lazy tab 模組用建置時自動產生的 timestamp（`buildVersion`）。這個機制歷史上造成過至少一次「部署了但使用者端沒更新」的困惑，細節見 CLAUDE.md。
4. **Migration 從不自動部署**：這是整個專案協作歷史中**出現頻率最高的提醒**——寫一個 `supabase/migrations/*.sql` 檔案、commit、push，**完全不會**讓正式資料庫改變。使用者必須手動 `supabase db push` 或貼到 Dashboard SQL editor 執行。整個專案歷史中有非常多次「回報 bug 還在」結果是「migration 檔案寫對了但沒部署」。
5. **`plan_kind` 是計畫系統的核心分類欄位**：`global_plans.plan_kind` 決定一個計畫是一般計畫、教會季度挑戰階段（`church_campaign_stage` / `church_campaign_stage_cohort`）。每日靈修（`devotional`）與小組聚會週計畫（`group_meeting`）已在 2026-10 拆成獨立專案並從資料庫移除（#425）。這個欄位的值域隨著功能擴張持續增加，很多判斷邏輯要記得同時處理新舊 kind。

---

## 二、目前進度與已確認的邏輯

以下依功能領域整理，同一領域內大致按時間順序。**migration 編號、版本字串、部署狀態都是該功能被記錄當下的快照**，請對照上面的新鮮度警語。

### 2.1 會員資料同步與組織架構（Member Hub 整合）

- 使用者的大區/牧區/小組歸屬、是否為某層級的負責人，是從 Member Hub 在 `nlc-session` Edge Function 登入時同步過來的，走兩個**互相獨立**的欄位管道：「角色指派」（`leadershipIdentity.assignments`）跟「個人牧養歸屬」（`organization`/`placementLevelName`/`placementNodeName`）。**兩者不保證一致**——一個人可能被指派為某小組長，但自己的個人歸屬欄位是空的。任何判斷「這位領袖負責哪裡」的程式碼，都該有「`managed_*` → 個人歸屬欄位 → `member_context_leadership_assignments` 備援」三層查找；目前只有 `plan.js` 完整套用，`admin.js` 的部分畫面尚未補齊（見 `feedback_member_hub_leadership_assignment_vs_placement`）。
- 大區/牧區的**顯示順序**（用於各種匯出）是寫死在 `js/modules/admin.js` 的兩個 JS 常數陣列（`CHURCH_GREAT_REGION_ORDER`/`CHURCH_PASTORAL_ZONE_ORDER`），不是資料庫的 `sort_order` 欄位——那個欄位存在但目前整個 app 沒有任何地方讀它，是舊架構的孤兒欄位。
- `senior_pastor`（教會牧者）角色曾被誤判成「要新增一個角色」，實際上使用者的意思是「改名」，導致要用第二支 migration（0079）把新建的重複角色刪掉、把原角色改名。這是一個關於「使用者說『一樣，只是改名』時該怎麼做」的重要協作教訓（見規範章節）。
- **2026-09-21（本文件整理當下最新）**：發現 Member Hub 自己的組織樹上會有一個真實存在、名字叫「未定」的佔位節點（代表「尚未安置」），跟 app 自己的空值標籤「未設定」是兩套不同機制，過去被誤當成真實組織單位寫入資料庫，造成入會資格閘門失效、後台統計多一個假分類、可能被延後梯次誤匹配。已在 `nlc-session`/`nlc-profile-sync.mjs` 源頭正規化為 `null` + migration `0191` 一次性清理。完整細節見 [`docs/placeholder-org-unit-normalization.md`](placeholder-org-unit-normalization.md)。

### 2.2 讀經計畫核心引擎：輪次、進度、排程

- **進度比對的唯一基準**（2026-08-31 定案）：「落後/超前/補讀」這類天數指標，一律用**教會原始階段日程**（該階段書卷章數 ÷ 起訖天數、平均鋪、每週七天）當比較基準，**不受**使用者個人的 `level`（已完全拆除）或 `rest_weekdays` 影響。第一遍完成後（`current_round > 1`）不再顯示「超前/落後」，只顯示輪次進度。
- **`level`（突破/興盛/讀N遍）與升降級鎖已於 2026-08-31 完整拆除**（migration `0138`）——這是一次高風險大重構，過程中連續踩了三個坑，被記錄成一則重要的協作教訓（見規範章節「大重構要 runtime 驗證」）：(1) 刪程式碼區塊時漏刪了被引用的變數宣告，造成正式站「全部計畫消失」的 P0 事故；(2) 拆多輪排程邏輯時，誤刪了實際上獨立於 `level` 的「多輪日曆疊圖」邏輯，導致「第二遍紀錄不見」；(3) 之後 `carry_reading_teams_to_stage` 等函式因為用字串取代（而非整支 `CREATE OR REPLACE`）改寫，遺留了對已刪欄位的引用，又造成一次「無法進入計畫」的 P0（hotfix migration `0165` 把 `level` 欄位加回當 no-op）。
- **遍數超過日曆天數會排不進日程**（2026-09-09 修）：`segmentScheduleDaysForRoundCount` 原本有「每遍至少一格」的 clamp，當遍數（如 31）大於日曆天數（如 30）時，最新一遍會被排到「結束早於開始」的空區間，導致一整頁進度顯示成「補讀休息日」。修法：已完成的遍照實際打卡日期擺（可疊在同一天）、目前這一遍拿整段剩餘日曆平均分配打散排程，不再用「每遍至少一格」的假設。
- **「累積閱讀章數」不該把無歸屬（`plan_id IS NULL`）的打卡記錄灌進當前計畫**——這條退路原本是為了相容舊資料，但 `reading_logs` 表本身沒有 `preset_key`/`global_plan_id` 欄位，讓這條退路名不符實，變成「凡是沒有 `plan_id` 的紀錄都算進當前計畫」，造成章數比實際多。已拿掉這條退路。
- **教會挑戰階段（campaign stage）系統**：master 計畫定義在 `global_plans.rules->'stages'`，透過 trigger 展開成一列列 `global_plans`（`plan_kind='church_campaign_stage'`）。「第一輪期末賽」（stage 2）後來被拆成四張獨立的月度計畫（出/利/民/申），衍生出兩個待清理的幽靈問題：舊的聚合 stage-2 列仍會被 trigger 重新生成（migration `0151` 收窄 trigger 跳過 stageNo 2）；以及「鐵獎」徽章判定邏輯要考慮四卷是否都完成（見「遊戲化」小節）。
- **延後大區梯次**（`plan_kind='church_campaign_stage_cohort'`）：讓某一個大區整條 2026–2029 計畫延後一個階段開跑，設計上是完全獨立的平行計畫（不併入全教會統計）。這個功能牽動非常多既有的「只認 `church_campaign_stage`」的判斷點，過程中一路發現漏補的地方（團隊建立、排行榜、carry-over），最後靠兩個共用述詞 `is_campaign_stage_kind`/`is_canonical_campaign_stage_kind` 統一收斂判斷邏輯，避免以後再有第三種 stage kind 出現時又要全庫搜一次字面值比對。

### 2.3 排行榜與統計的語意（重要：兩套故意不同的邏輯共存）

這個專案裡有兩種**故意不一樣**的「章數/進度」計算方式，未來改動前務必先分清楚是哪一種：

1. **「進度狀態」**（計劃管理後台表格）——**只算目前這一輪**，換算成天數跟教會標準進度比較。是刻意設計：避免「一直複讀的人」永遠壓過「剛開始讀的新手」，確保跨進度公平比較。
2. **「章數排名」**（3/6人團隊排行榜、牧區速度排行榜、個人排名）——**累計全部輪次**，複讀也算進去，因為使用者明確認為「複讀也是努力，不該不算」。

同理，「個人排行（報名者為母數）」跟「牧區速度榜（全牧區在籍人數為母數）」兩張卡片人數不同也是**刻意的兩套母數**，不是 bug——這點在使用者一度要求統一、又主動取消改動、改成只加 UI 說明文字後定案。**看到兩邊數字對不上，不要預設是 bug，先確認是不是這兩套已知的語意差異。**

### 2.4 團隊功能（3人/6人讀經團隊）

- **邀請碼換隊的邊界情況**：使用者已在同計畫同組別有另一隊時輸入別隊邀請碼，舊版會誤判為「加入成功」——已修正為明確區分「碼是自己那隊」（無動作成功）vs「碼是別隊、但自己已在其他隊」（清楚的錯誤訊息，要求先離隊）。
- **「帶隊進入下一階段」（carry-over）曾經因為單一成員衝突就讓整個交易 rollback**，卡住整隊——已改成「跳過衝突的那個人，其餘正常帶入」，並把功能從「自動彈窗、拒絕一次整季不再問」改成隊長可自行按的常駐按鈕。
- **已結束階段的隊伍資料被誤改，是「隔幾天又退回」錯覺的真正根因**：同一支邏輯隊在教會挑戰的每個階段各自有一列獨立 `reading_teams`（carry-over 是一次性快照，之後不會回頭同步），管理員如果在**已結束**的舊階段畫面調整成員名單，那個調整永遠不會反映到現行階段——看起來就像「改了又被退回去」。已加資料庫層級的觸發器擋下對已結束階段隊伍的寫入，並在前端隱藏對應的操作按鈕。這個案例花了兩輪調查（第一輪甚至建了一張稽核記錄表想抓「兇手」）才找到真正原因，教訓是：**碰到「看起來像被還原/複寫」的詭異 bug，先確認是不是操作了資料的錯誤副本/舊快照，而不是急著懷疑併發或系統自動行為**。
- 「查看內容」在同時加入 3人隊與6人隊時，原本用 `<select>` 隱藏第二個選項，導致使用者以為只有一隊、看不到另一隊——這類「≤3 個互斥選項」的切換器，全站已改用常駐並排的 segmented control 取代下拉選單（見規範章節）。

### 2.5 大測驗（速讀考核）系統

這是整個專案中規模最大、迭代次數最多的功能，架構上與既有的「今日小測驗」（`daily_quiz`）完全獨立（新表、新 RPC、新 feature flag），只沿用相同的模式（dual-client shim、nlc-data allowlist、`resolve_quiz_actor` 慣例）。核心設計沿革（供理解「為什麼現在長這樣」，非逐步操作手冊）：

- 六大題型（是非/單選/多選/配對/排序/簡答），前五型自動計分、簡答人工批改。獨立頁面 `exam.html`，滿版沉浸式作答體驗，倒數計時以伺服器 `deadlineAt` 為準、前端錨定本地時鐘避免漂移。
- **測試版／正式版分離**（`mode: test/live`）：這個設計本身經過至少 6 輪反覆調整（P4g→P4l 這段），中間試過「mode 決定誰能作答」「切 mode 連動清預告文」等方案，最終定案是**測試版與正式版是兩份完全獨立的 `exam_papers` 列**（`pushed_from_id` 關聯），測試版可自由編輯、用「推上正式版」單向同步過去；正式版一旦有人作答或處於「測驗進行中」狀態，就不能再被覆寫題目（防止 question id 換掉導致既有作答對不上）。
- **發布拆兩段**：「發佈預告文」（純粹是否對外顯示宣傳 banner 的旗標）與「發佈測驗」（真正開放作答、鎖題庫）是兩件獨立的事，前者是後者的前置條件（正式版才需要，測試版不需要預告文）。
- **成績公布後永久鎖定**：`results_published_at` 一旦設定，答案、計分、批改全部鎖死，不能再改——這是刻意的資料完整性保護，執行前必須先確認所有作答都已批改完成。
- **簡答題答案遺失**曾是一個真實影響使用者的問題（送出大 payload 在飛機/爛網路上被截斷、iOS 語音輸入不觸發 `input` 事件、15秒 autosave 沒趕上），修法是三層防禦：前端更頻繁 autosave + 送出前先同步 DOM + 結果頁比對本機鏡射自動回補 + 後端一支專門的 backfill RPC。
- 團隊排行榜（3/6人隊）曾兩度出現「0隊」與「重複列」問題，根因分別是「作答時沒帶團隊 id 導致查詢對不上」與「carry-over 產生的多階段隊伍副本沒有去重」，兩者都用「不依賴容易漏帶的快照欄位、改成即時查詢當下的團隊成員關係，並用 `carried_from_team_id` 遞迴收斂到同一條邏輯隊鏈」解決。**這是一個可重用的模式**：任何跟教會挑戰階段/carry-over 交互的統計邏輯，都要考慮「同一支隊伍在資料庫裡其實有多筆歷史副本」這件事。
- PR 值（百分等級）功能：對會友只公布 PR 不公布名次或隊友分數，母數固定為「全教會」以確保會友端與後台看到的數字一致；可見性用「是否已公布」+「角色」兩個維度控制。
- 統計可依「是否讀完該書卷至少一遍」過濾（`_user_read_book_once`），以及測驗可綁定對應的讀經計畫（`linked_plan_id`，只能在測試版草稿設定，發布後自然鎖住），讓團隊排行只反映「熱身賽本身」的隊伍，不被後續階段/延後梯次的隊籍變動污染。
- 線上批改（`grade.html` 獨立頁）走「指派制」：後台把簡答題指派給特定批改人員，對方登入後只看到指派給自己的卷；曾在「批改頁 vs 純 CSV 匯出」兩個方案間來回過（Option A/B），最終定案指派制。批改序號後來固定化（`seq` 欄位，指派當下決定、改派保留），方便批改人員之間用「第幾份」互相溝通進度。

### 2.6 每日靈修 / 小組聚會週計畫（已拆出，#425）

2026-10-03 維護者定案：這兩個功能不跟速讀掛勾，改成獨立的新專案 `heryiyu/newlife-devotion-group`（內容、舊程式與設計都保存在那裡）。速讀專案的前端、`nlc-data`、`sync-devotion-video` 與資料表都已移除（migration `20261004015147_remove_devotion_group_meeting.sql`）。「分享今日金句」與牧區分享牆（`devotional_notes` 等）是速讀本身的功能，不受影響。

### 2.7 問題回報系統（唯一的 React island）

從「一段描述文字 + 一個 metadata.reply 欄位」升級成正式的「工單 + 對話串」模型（`issue_reports` + `issue_report_messages`），支援雙向多則訊息、每則訊息可附一張截圖、管理員可加內部備註。這個功能因為是 React + Tailwind CDN 元件，牽出了整個專案唯一一批「配色系統」相關的重複踩坑：**三次**（不同批次）被回報「文字/圖示看不到」，根因每次都相關但不完全相同——原生 Tailwind 調色盤 class（不隨主題翻轉）、裸 `<button>` 吃到瀏覽器預設樣式、以及元件重掛載造成的其他邏輯 bug（見規範章節「React 元件配色」）。另外還有兩個獨立的「進了對話出不來」bug：手機版 fixed 定位的堆疊脈絡陷阱、以及元件重新掛載重置了「只自動開一次最新對話」的守衛。這系統也帶出了「有回報就自動出現在對話列表」「管理員可切換回覆模式/會友模式」等使用體感的持續打磨。

### 2.8 效能與網路優化

兩條獨立但相關的優化主線：

1. **「回前景就狂重繪」**：根因是沒有單一狀態協調層，十幾個 `visibilitychange`/`focus` 監聽器散落在各檔案各自觸發完整重同步。已收斂成單一 `onAppForeground()` 協調器（45秒全域節流），拿掉大部分個別監聽器。順帶處理了「token 4xx 就誤清整個登入狀態，觸發無窮迴圈」的問題（先檢查有沒有別的分頁已經換好新 token，不要急著清）。
2. **「太多 fetch」**：正式環境每個資料查詢都是一次獨立 POST + 一次 Logto 驗證，冷開儀表板一度量到近 30 個請求。透過「加一個 `action:"batch"` 讓多個唯讀查詢共用一次驗證」「把幾個獨立小查詢合併成一支預聚合 RPC（例如把掃全教會 `profiles` 建組織樹改成一支 `get_org_structure_tree` RPC）」「重複讀取去重（in-flight promise 共享）」「設定值一次撈取快取」等手法，把冷開請求數從 ~30 壓到 ~14。**這一系列優化的一個重要教訓**：曾試過把 `@supabase/supabase-js` 整個移出關鍵路徑（A1），結果造成正式站「登入後整頁黑」的事故兩次——因為真正的 Supabase client 其實是 Logto session 失效時的優雅降級讀取路徑（可以匿名讀公開表），拿掉它會讓 session 死掉時每個請求都直接 throw。**任何「移除看似沒用到的關鍵路徑資源」的優化，都要先確認它是不是某個失敗情境下的安全網。**這個特定優化已回退並保留其他更安全的優化（Chart.js/html2canvas 延遲載入等）。

### 2.9 登入態穩定性（Logto token 續期）

「用到一半被登出」是長期被抱怨的問題，根因牽涉 Logto 後台設定（refresh token rotation 在多分頁/多裝置場景下會互相作廢彼此的 token）與前端續期邏輯（缺乏跨分頁鎖、discovery 沒有快取容錯）。已完成的修法包括：關閉 Logto 的 refresh token rotation、改用標準 `offline_access` scope、前端用 `navigator.locks` 做跨情境續期序列化、放寬時鐘容錯與續期緩衝時間。另外處理了「session 在使用中途死掉，卻沒有任何機制把登入卡叫回來，使用者停在資料空掉的畫面」的問題——現在會在下次回前景、或 token 續期徹底失敗的當下，主動顯示登入卡而不是讓使用者自己想到要重新整理。

### 2.10 部署管線

2026-08-26 曾發生一次完整的正式站中斷（首頁 404、登入功能全壞），三個獨立根因疊加：GitHub Actions 的 Vercel token/org/project ID 設定錯誤、`vercel.json` 的 `cleanUrls` 設定下 `/` 沒有對應到 `/index` 的 rewrite、以及環境變數被設成 Vercel 的「Secret」型別（在 GitHub Actions 這種外部建置環境下讀不到值，導致 `config.js` 生成空值）。這次事故產出的診斷技巧（直接看 `.vercel/output/config.json`、用 `curl -I` 逐一測路徑）跟三個修法都被記錄下來，因為排查這類「站台整個掛掉」的情境最耗時間。

---

## 三、需要遵守的規範與程式碼/架構細節

### 3.1 資料庫欄位與查詢陷阱

- **`reading_team_members` 沒有 `id` 欄位**——主鍵是 `(team_id, user_id)` 複合鍵。任何 `.select("id, ...")` 或 SQL 引用這張表的 `id`/`membership.id` 都會撞 Postgres 42703 錯誤。這個錯誤在專案歷史中**至少重複出現過 4 次**，因為其他大多數表都有代理鍵 `id`，很容易想當然爾。
- **`managed_regions`/`managed_zones`/`managed_groups` 等欄位是 `NOT NULL DEFAULT ''`，永遠不是 SQL NULL**。寫入時要寫 `''` 不能寫 `null`（否則違反約束觸發 400）；讀取/比較時必須用 `COALESCE(NULLIF(col, ''), fallback, '')`，不能用純 `COALESCE`（空字串不會讓 `COALESCE` 短路，會讓「已設定但空」被誤判成「有值」而漏接退路）。
- **空的 managed-scope 陣列必須「fail closed」（比對不到任何東西），絕不能「fail open」（比對到所有東西）**。`CARDINALITY(arr) = 0 OR field = ANY(arr)` 這種寫法是資料外洩漏洞，不是合法的「無限制」捷徑——這個漏洞出現過不只一次，因為修補時只加了退路欄位、沒有拿掉這個 bypass 本身。優先使用專案既有的 `public.values_overlap()` 輔助函式，它天生 fail-closed。
- **`profiles.role`（文字欄位）已被移除**，角色改走 `role_id` → `role_definitions.code`（透過 `public.role_code(role_id)`）。任何 SQL function 如果還在讀 `actor_profile.role`，會對每一次呼叫都撞 42703——這種問題有前端 fallback 兜底時容易被忽略（畫面看起來正常，只是 console 一直報錯），要留意。

### 3.2 部署流程規範

- **寫一個 `supabase/migrations/*.sql` 檔案、commit、push，完全不會讓正式資料庫改變**。這是整個專案歷史中最常需要提醒的一件事。每次新增/修改 migration，都要在同一輪回覆裡明確告知「這支 migration 還需要手動部署」，並在診斷「修了但還是壞」之前，先確認相關 migration 是否真的已經部署。
- **Vercel 環境變數（`SUPABASE_URL`/`NLC_CLIENT_ID` 等）一律要設成「Config」型別，不能設成「Secret」型別**。Secret 型別在 GitHub Actions 這種外部建置環境執行 `vercel pull` 時讀不到值（write-only 設計），會讓 `config.js` 靜默生成空值，正式站直接壞掉且建置不會報錯。這些值本來就會被打進公開的前端 bundle，用 Secret 型別完全沒有額外保護、只有壞處。
- 很多後端功能除了 migration 之外，還需要**重新部署對應的 Edge Function**（`nlc-data`/`nlc-session`/`issue-report-maintenance` 等）才會生效——只跑 migration 但沒重部署 Edge Function，新的 RPC 呼叫會被 allowlist 擋下（`forbidden_rpc`）或函式簽名不同步。純 `CREATE OR REPLACE`（簽名不變）通常不需要重部署 Edge Function；新增 RPC 或改變參數才需要。
- **新的 SQL function 預設對 `PUBLIC` 可執行**，`anon` 角色會透過 `PUBLIC` 授權**遞移繼承**到執行權——單獨對 `anon` 下 `REVOKE` 是沒用的，因為權限來源是 `PUBLIC` 而非 `anon` 專屬授權。這個問題導致過 ~29 個函式在兩輪清理嘗試後依然對匿名可呼叫，直到第三輪改用 `has_function_privilege('anon', ..., 'EXECUTE')` 逐一檢查才真正抓乾淨。**現在的規則是：每一個新的 `CREATE FUNCTION`/`CREATE OR REPLACE FUNCTION` 都要在同一支 migration 裡明確 `REVOKE ALL ... FROM PUBLIC` 再 `GRANT EXECUTE` 給該給的角色**，不要等下一輪安全掃描來抓。若函式是 `SECURITY DEFINER` 且執行特權寫入（繞過 RLS），除非真的設計成給前端直接呼叫，否則預設只給 `service_role`，不要順手給 `authenticated`——這正是過去修過不只一次的「直接繞過 RPC 存取控制」漏洞形態。

### 3.3 安全規範

- **`nlc-data` Edge Function 在正式環境用 service-role key，Postgres RLS 對它完全不生效**。這是一個標準架構事實，不是一次性 bug，但曾經造成真實的資料外洩風險（例如 `reading_teams` 曾一度透過泛用的 `select` action 無範圍限制地暴露）。**任何透過 `nlc-data` 泛用 `select`/`rpc` 曝露的資料表，`applyForcedScope()` 是唯一真正的存取控制**；新增表格或 action 時要明確檢查是否需要在裡面加一個分支。
- 涉及個人身份/隱私資料的功能（例如逐節筆記 `verse_notes`）如果設計上要讓「連牧者/管理員都看不到」，這是刻意設計，要在 RLS 跟 `applyForcedScope()` 兩邊都落實一致。

### 3.4 前端驗證與測試規範

- **`npm run dev`（`npx serve .`）目前無法正確載入這個 app**，因為 `js/app.js` 直接 `import` 了一個真正的 `.ts` 檔案，靜態伺服器不會轉譯它，瀏覽器會拒絕載入整個模組圖。要在瀏覽器實際驗證行為，必須先 `npm run build` 再 serve `dist/`；否則靠 `vitest` + `node --check` + 針對純函式的 Node 直接呼叫驗證邏輯正確性。**看到本機開發伺服器整頁空白，先想到這個已知限制，不要當成新的 regression 去追。**
- **`node --check` 只驗證語法，抓不到 `ReferenceError`**——這曾直接導致一次正式站 P0 事故：大重構刪除程式碼區塊時，連同被後續程式碼引用的變數宣告一起刪掉，`node --check` 全綠、單元測試也沒涵蓋到那條路徑，結果部署後**每一個使用者的每一個計畫**都在載入時拋出例外，被一個「靜默吞掉錯誤」的 `try/catch` 迴圈吃掉，變成「全教會計畫消失」。**修改「每個使用者每次載入都會執行」的核心函式**（例如 `generatePlanObject`、`calculateAllPlansProgress`、`db.init` 的載入迴圈）時，光靠語法檢查與既有單元測試不夠，要用 Node 實際把該函式跑一次、餵真實形狀的輸入，確認回傳值正常。也要特別提防「單筆拋出例外、整批被靜默吞掉」這種寫法的爆炸半徑。
- **`scripts/*.test.mjs` 大多不是真正的行為測試，而是對原始碼文字做字串/正則斷言**（有些會把函式本體抓出來用 `new Function` 執行）。一個測試通過只證明「程式碼文字符合這個測試當初預期的樣子」，不證明行為正確。這個特性有個具體的反例教訓：曾經有一支測試斷言某函式該回傳 A，而目前程式碼回傳 B，一開始被誤判為「意外的 regression、要把程式碼改回 A」，結果 B 才是後來刻意的新設計、只是沒人回頭更新那支舊測試——直到發現另一支**更新的**測試檔明確記載了 B 才是設計意圖，才避免了誤改。**測試失敗時，先搜尋是否有涵蓋同一功能的更新測試檔、查 `git log` 確認是否有刻意的近期變更，再決定要修程式碼還是修測試。**

### 3.5 UI/設計系統規範

- **≤3 個互斥選項的切換器，一律用常駐並排的 segmented control，不要用 `<select>`**。原生 `<select>` 收合時完全沒有「這裡還有其他選項」的視覺線索，已造成至少一次「使用者以為功能沒有、其實只是沒點開下拉選單看到」的誤報。App 已有現成樣式（`.capsule-segmented-control`/`.segment-track`/`.segment-toggle-btn`）可以直接重用。
- **React 元件（`components/**/*.tsx`，Tailwind 由 `scripts/bundle.mjs` 在建置時依 `tailwind.config.cjs` 產生 CSS，見 #418；class 要寫完整字串、不可拼接）一律使用 `tailwind.config.cjs` 橋接的語意 token**（`bg-card`/`text-foreground`/`text-muted-foreground`/`border-border`/`bg-primary`/`text-primary`/`.stat-badge` 等），**禁止使用原生調色盤 class**（`bg-slate-950`/`text-cyan-400`/`text-amber-300` 等）——這些不會隨 app 的 light/dark/warm 三主題翻轉，換主題就會變成同色系疊同色系、文字或圖示完全看不見。這個問題在同一個功能（問題回報系統）上被回報了三次才徹底清乾淨，其中一次的根因甚至不是寫死調色盤、而是裸 `<button>` 沒有設定任何 `background`、吃到瀏覽器預設樣式在深色主題下變成隱形——**改完 React 元件後務必在瀏覽器三種主題下實測 computed style，不能只看原始碼有沒有寫死的 hex/調色盤 class**。
- 管理後台的子分頁如果是「滿版」設計（沒有其他並排欄位），不要疊加外層 `.glass-card` 卡片框——手機版 drill-in 時的 fixed 定位容器疊加固定高度的等高欄 class（`.card-col{height:100%}`），會讓內容被夾成剛好一個螢幕高、滑不動、底部內容看不到。這類「手機版 fixed 定位容器」也是造成過對話框「進去出不來」bug 的根因（`z-index` 被限制在該容器建立的新堆疊脈絡內，被其他固定元素蓋住）——解法通常是把這類彈窗/面板改成 `createPortal`/直接掛在 `document.body`，跳出受限的堆疊脈絡。
- 動態組出來的圖示 key（例如 `data-icon="${variable}"`）不會被自動化的圖示稽核測試掃到（該測試的 regex 抓不到 template literal 或含連字號的 key），新增這類程式碼時要人工核對 `js/design/icon-manifest.json`，並記得重新產生 `js/design/icon-registry.js`。
- 全螢幕彈出層（例如逐節筆記編輯框）的掛載點必須放在 `.view-pane` 之外、`<body>` 頂層——`.view-pane` 的進場動畫用 `forwards` fill mode 會讓元素永久帶有非 `none` 的 `transform`，任何非 `none` 的 `transform` 都會讓該元素變成子孫 `position: fixed` 元素的新錨點，導致「全螢幕」疊層其實只蓋住父容器自己的框而不是真正的整個畫面。

### 3.6 協作與溝通風格

- 使用者預設要求**用繁體中文回覆**，這是明確定案的規則，不是單次要求。
- 回報 bug 時，使用者常會明確要求「先給根因分析報告，再談修法」，不喜歡直接跳到一個修補方案；對 400 類錯誤，使用者願意提供瀏覽器 DevTools 的確切 Network payload，這比從堆疊追蹤猜測可靠得多，應該優先開口要。
- 使用者會主動檢視涉及公平性/排名/確定性的設計是否有邊界案例（例如四捨五入誤差、複讀是否該算進排名），在提出方案前最好先自己想過這些角度。
- 涉及個人資料（姓名、組織歸屬等）的功能，明確的既有邊界是**唯讀強制執行、不做站內自助編輯**——所有的個資修改都應該導去官方 Member Hub，不要自己做一個「貼心」的站內編輯表單。
- **當使用者說兩個東西「對我來說是一樣的，只是改名字」時，意思是原地改名（沿用同一個資料列/ID），不是建立一個新的、跟舊的並存的實體。** 曾經因為誤解成「新增一個角色」，導致要用第二支 migration 把重複的角色刪掉、把大約 15 個檔案裡寫死的舊角色字面值全部清乾淨——比一開始就做對多花了一倍以上的工。看到「一樣」「改名」「不再用」這類措辭時，優先假設是原地重新命名。

---

## 四、如何使用這份文件

- 接手一個新任務前，先看看第二節有沒有相關的既有功能脈絡，避免重新設計一次已經拍板過、甚至已經來回調整過好幾輪的東西。
- 動手改程式碼前，先掃一眼第三節有沒有踩到已知陷阱。
- 這份文件不會自動更新——每次做完一個值得記錄的功能/修正/教訓，應該回來補一筆，並且**修正掉已經過時的「未部署」等狀態描述**，避免文件本身變成新的錯誤資訊來源。
