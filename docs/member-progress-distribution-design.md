# 組員總覽：進度分布圖設計

狀態：設計中，尚未實作（2026-09-23）

## 需求

在「系統管理 → 組員總覽」加入一張圖，顯示各進度各有幾人：
讀 0 章（未讀）幾人、讀 1 章幾人、讀 2 章幾人……

## 現況（已查證）

- 「組員總覽」分頁（`js/modules/admin.js` `ADMIN_SECTIONS` id `members`）對應 `index.html` 的 `#admin-section-members`。
  它沒有自己的內容：`mountPlanManagementSections()` 會把 `#member-list-container`（參與者總覽卡片）搬進 `#admin-plan-participants-slot`。
- `renderGroupParticipantsRankingTable()`（`js/modules/plan.js`）已經為目前範圍內的每位組員算好：
  - `completed`：本計畫已讀章數，以 `book_chapter_round` 去重，**第二遍以上會累加**
  - `isNotStarted`、`isBehind`、`statusStr`（未開始／落後 N 天／今日未完成／在進度上／超前 N 天／第一遍完成／第 N 遍…）
  - 結果存在 `window._grpScopedProcessedMembers`，已套用權限範圍與大區／牧區／小組篩選
- `db.fetchMergedUsersList(planKey)` 只回傳**已加入此計畫**的人（`if (filterPresetKey && !uPlan) return null`），
  所以「0 章」＝已加入但尚未讀，不包含沒加入計畫的人。
- `renderOrUpdateChart(key, canvas, config)` 會自動延遲載入 Chart.js，重複呼叫只更新、不重建。
- **不需要新增任何 DB 查詢或 migration。**

## 原方案（v1，照建議）

| 項目 | 決定 |
|---|---|
| 位置 | `#member-list-container` 內、參與者總覽卡片上方的新卡片 |
| 圖型 | 長條圖（直方圖）：X 軸章數，Y 軸人數 |
| 分組 | 預設每章一根；長條超過上限（手機約 30 根）時自動每 5 或 10 章合成一組 |
| 第二遍以上 | 不算入章數；另放一根「第一遍已完成」長條 |
| 範圍 | 跟大區／牧區／小組篩選連動，**不**跟姓名搜尋框連動 |
| 名稱 | 「進度分布」（這是單一時間點的分布，不是隨時間變化的趨勢） |
| 顏色 | 品牌色 `#04A9D2` 純色，不用漸層；「0 章」用淡色 |
| 程式結構 | 新增純函式模組 `js/modules/member-progress-distribution.mjs`（`members → buckets`），附 vitest 測試；`plan.js` 在 `_grpScopedProcessedMembers` 算好後呼叫一次 |
| 快取 | `plan.js` 是延遲載入的 chunk，建置時自動換檔名；只有改到 CSS 檔時才要更新 `index.html` 裡對應 CSS 的 `?v=` |

## 與主流 APP 比較

| 產品 | 帶領者／老師看進度的做法 | 可借鏡的地方 |
|---|---|---|
| Microsoft Teams Education Insights／Reading Progress | 依狀態分組的長條，點一下列出那一組的學生 | 點圖 → 篩出名單，直接能關懷 |
| Google Classroom、Canvas | 每份作業顯示「已繳／未繳／遲交」人數 | 相對「應完成」的狀態比絕對數字好行動 |
| Khan Academy 教師端 | 一條依熟練度分段上色的堆疊橫條＋各段人數 | 一眼看全貌的摘要條 |
| Coursera 講師端 | 依單元（module）完成數畫漏斗／直方圖 | 按有意義的單位分組，不按最細的顆粒 |
| Strava、Garmin | 分布圖上標出「你在這裡」或基準線 | 參考線讓圖立刻有意義 |
| YouVersion「和朋友一起讀」 | 每位朋友讀到第幾天，沒有整體分布圖 | 單純的人數分布不常見，常搭配狀態使用 |

### 比較結論

原方案能回答「各進度幾人」，但主流做法一致多做了兩件事，讓帶領者看完圖**知道要關心誰**：

1. **標出「今天應讀到第 X 章」的參考線**，長條依相對位置上色：落後（紅）／在進度（品牌色）／超前（綠）。
   不然組長看到「讀 12 章：5 人」，無法判斷好壞。`expectedDaysCount` 與 `baselineScheduleDays` 已經有了，換算成應讀章數不需要新資料。
2. **點長條就篩選下方名單**，只顯示那個進度的人。帶領者從圖直接到關懷名單（名單已有「提醒」按鈕）。

可選的第三件事：

3. **圖上方加一條狀態摘要**（堆疊橫條或 5 個數字）：未開始／落後／今日未完成／在進度上／超前・完成。
   直接沿用每位組員已有的 `statusStr`，和下方表格的進度狀態欄完全一致。

評估後不採用的：

- **真正的時間趨勢圖**（例如每天「在進度上」的人數變化）：要用所有人的 `read_at` 回推每一天，計算量和資料量都大很多，主流 LMS 也少見。先不做。
- **改成按「計畫第 N 天」或書卷分組**：雖然比較貼近進度，但你明確要求按章數；改用參考線與上色就能取得同樣的判讀效果。

## 建議方案（v2 = v1 + 改良）

- 第一階段：v1 直方圖 **＋ 參考線與三色上色 ＋ 點長條篩選名單**
- 第二階段（可選）：狀態摘要條

額外成本：參考線與上色只是純計算；點長條篩選要在 `displayParticipantsList()` 多一個篩選條件，另加一顆「清除篩選」按鈕。

## 待確認

- [ ] 採用 v2 還是維持 v1
- [ ] 狀態摘要條要不要做
