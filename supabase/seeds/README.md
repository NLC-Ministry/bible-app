# 內容 seed

建立教會內容（計畫、靈修、小組聚會週次）的 SQL。**會寫入資料**，由管理後台的提示引導管理員在需要時執行。

| 檔案 | 用途 | 引用位置 |
|---|---|---|
| `seed_devotional_plan_acts_1.sql` | 建立「使徒行傳」靈修計畫 | 管理後台「靈修」分頁的空白提示（`js/modules/admin.js`） |
| `seed_group_meeting_plan_2026_h2.sql` | 建立「小組聚會經營（2026 7-12月）」 | 管理後台「小組聚會」分頁的空白提示、`docs/group-meeting-plan-design.md` |

先在 staging 執行並確認，再到正式環境執行。會員個人資料的測試資料不要寫在這裡，改用 `scripts/staging-sample-data.mjs`（見 `docs/staging.md`）。
