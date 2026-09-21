# Member Hub 「未定」佔位組織名稱正規化

> 分支：`claude/normalize-placeholder-org-unit-names`　commit：`786948e`
> 狀態：**程式碼已 commit，尚未部署**（見下方「待辦」）

## 1. 專案核心目標與背景

本專案（新生命聖經速讀計畫）的組織架構（大區/牧區/小組）**不是自己維護的**，而是從 Member Hub（會員中心）在登入時同步過來的：使用者登入 → `nlc-session` Edge Function 驗證 Logto token → 從 Member Hub 回傳的 care-chain / home-path / 組織節點資料中抽出大區/牧區/小組名稱 → 寫入 `profiles.great_region` / `pastoral_zone` / `small_group`（文字）及對應的 `*_id`（外鍵），並視需要 upsert 進 `great_regions` / `pastoral_zones` / `small_groups` 這幾張表當成真實單位。

問題根因：Member Hub 自己內部也有「尚未安置會友」的概念，而它的表示法是在組織樹上放一個**真實存在、名字就叫「未定」**的節點（在大區/牧區/小組任一層都可能出現）。這個「未定」節點在同步邏輯眼中和「資訊事工」「大安小組」這種真實單位長得一模一樣（都有 `name`），所以會被原封不動當成真正的組織單位處理。

這和本 app 自己既有的「空值標籤」`「未設定」` 是兩個完全不同的機制：
- `「未設定」` 是 `get_admin_registration_statistics`（migration 0080）裡對「欄位是空字串/NULL」做的 `COALESCE` 顯示用字，本身不是資料庫裡的一列。
- `「未定」` 卻是被寫進 `profiles.great_region` 等欄位、甚至 upsert 成 `great_regions`/`pastoral_zones`/`small_groups` 裡真實一列的**資料**。

## 2. 目前進度與已確認的邏輯

已確認並修好的因果鏈（三個下游症狀，同一個根因）：

1. **入會資格閘門失效**：app 裡任何「檢查使用者有沒有填大區」的判斷都是看欄位是不是空/假值（例如 `js/modules/plan.js` 的 `viewerRegionMissing` 這類檢查、`[[project_plan_join_missing_region]]` 修過的「未填牧區進不去計畫」邏輯）。因為「未定」是非空字串，這些檢查全部誤判成「已填寫」，導致使用者卡在一個假大區裡，永遠不會被導去 Member Hub 補資料。
2. **後台統計/匯出多一個假分類**：`get_admin_registration_statistics` 的「報名與註冊統計」和 Google 試算表匯出，會把「未定」當成一個和真實大區並列的獨立分組顯示出來，跟本來就有的「未設定」（真空值）分開列，造成使用者混淆、數字對不起來。
3. **可能被「延後大區梯次」誤匹配**：`assert_campaign_stage_open`（migration 0127）比對 `audience_regions` 陣列時是純字串比對，如果哪個延後梯次的 `audience_regions` 剛好包含字面 `"未定"`，這些使用者會被誤判進該梯次。

**已確定的修法（已寫進程式碼、已 commit）**：在資料寫入的**最源頭**做正規化，而不是在下游各處補判斷——把 `"未定"` 這個字串在寫入 `profiles`/`great_regions` 等表之前就轉成 `null`，讓它自然落入本來就存在的「未設定/未填寫」處理路徑（下游所有現成的 blank/falsy 檢查、`COALESCE` 顯示都不用改）。

具體改動：
- `supabase/functions/nlc-session/index.ts` 與 `scripts/lib/nlc-profile-sync.mjs`（兩處邏輯是刻意保持同步的複本，其中一個檔案的函式註解寫著 `Keep in sync with ...` 提醒）都新增 `PLACEHOLDER_ORG_UNIT_NAMES = Set(["未定"])` 常數與 `normalizeOrgUnitName()` 函式，套用在 `pickNameByDepth` / `pickNameByLevelName` / `orgFromMemberContext` 三個抽取組織名稱的路徑上，涵蓋大區/牧區/小組三層。
- `scripts/nlc-profile-sync.test.mjs` 新增三個測試：`orgFromCareChain`、`orgFromHomePath`、`mergeOrgSources` 各驗證一次「未定」被轉成 `null` 而不是被當真名稱。
- `supabase/migrations/0191_normalize_placeholder_org_unit_names.sql`：一次性資料清理。分大區/牧區/小組三層，各自：先把指到「未定」的 `profiles` 欄位清空（`great_region`/`pastoral_zone`/`small_group` 設回 `''`，對應 `*_id` 設 `NULL`），再刪除已經沒有任何 `profiles` 或子層引用的孤兒「未定」列。目前已知受影響：3 筆 `profiles`（在後台「報名與註冊統計」被發現：一個限定桃園大區的計畫底下多出「未定」大區分組）。

## 3. 需要遵守的規範與程式碼/架構細節

- **`great_region`/`pastoral_zone`/`small_group` 是 `TEXT NOT NULL DEFAULT ''`（migration 0001）**——「未設定」的正確表示法是空字串 `''`，不是 `NULL`。對應的 `*_id`（`great_region_id`/`pastoral_zone_id`/`small_group_id`）才是可為 `NULL` 的外鍵欄位。寫遷移或後續清理邏輯時兩者不要混用（0191 遷移的 `UPDATE` 就是分別設 `''` 和 `NULL`，可參考）。
- **`nlc-session/index.ts` 與 `scripts/lib/nlc-profile-sync.mjs` 是刻意維護的兩份同步邏輯複本**（一個跑在 Edge Function、一個是本地/CI 用的腳本工具），兩邊都有 `Keep in sync with ...` 註解互相提醒。之後若要再調整組織名稱抽取邏輯（例如新增其他佔位字串），**兩個檔案都要改**，不要只改一邊。
- 這類「值本身是合法字串、但語意其實是佔位符」的問題，**優先在資料寫入源頭正規化**，而不是在每個下游消費點（閘門檢查、統計函式、梯次比對）各自加特判——本次修法示範的就是這個原則，未來如果 Member Hub 又冒出其他佔位名稱（例如「無」「N/A」之類），比照擴充 `PLACEHOLDER_ORG_UNIT_NAMES` 集合即可，不要在 `plan.js`/`admin.js` 裡分頭加 `!== '未定'` 這種判斷。
- **部署待辦（尚未執行）**：
  1. `supabase db push`（或貼到 SQL editor 執行）migration `0191_normalize_placeholder_org_unit_names.sql`，清掉目前已受影響的 3 筆 profiles 和孤兒組織列。
  2. **重新部署 `nlc-session` Edge Function**（`supabase functions deploy nlc-session`）。這一步不能省——如果只跑了 migration 沒重部署，受影響的會員下次登入時 `nlc-session` 舊邏輯還是會把「未定」原封不動再寫回去，等於白清。
  3 兩步都要做，順序不重要，但**兩步都不能漏**。
- 相關既有記憶／規則（可交叉參考）：
  - [[project_plan_join_missing_region]] — 同一類「大區欄位空值」問題曾在前端補過友善訊息，本次是從根源堵住新的空值來源，兩者互補不衝突。
  - [[feedback_supabase_migrations_not_auto_deployed]] — migration 檔案本身不會自動套用到正式站，需要人工 `supabase db push` 或貼 SQL editor。
  - [[feedback_empty_managed_scope_must_fail_closed]] — 同樣是「空值/未設定要如何安全處理」的既有原則，判斷邏輯風格一致：寧可判定為「未填寫」而收斂權限/資格，也不要誤判成「已填寫某個假值」而放行。
