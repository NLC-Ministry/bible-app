# PostgreSQL / Supabase 資料庫防禦審計

## 結論

本 Schema 的狀態集合很小且未被其他系統當成 PostgreSQL 型別依賴，因此目前保留 `TEXT + CHECK` 比建立 ENUM 更安全：新增狀態只需要 Migration 更新 constraint，不會承擔 PostgreSQL ENUM 難以刪除、改名與跨環境排序的成本。既有 `profiles.role`、`user_identities.provider`、`reading_plans.level`、`care_reminders.reason/status` 已有 CHECK；0010 Migration 補的是邊界、狀態轉移及跨資料列一致性。

## 主要風險與處置

| 風險 | 嚴重度 | 防禦 |
|---|---:|---|
| `verse_likes.like_count` 可由瀏覽器任意覆寫或寫成負數 | Critical | 非負 CHECK、撤銷直接寫入、只允許原子 RPC |
| NLC service-role 代理允許一般使用者直接寫 `profiles` 與 `verse_likes` | Critical | 從 OWN_WRITE allowlist 移除，profile 只能走 `save_profile`，like 只能走 RPC allowlist |
| `profiles_manage_own FOR ALL` 可能讓成員嘗試修改 `role/is_active/is_demo` 或刪除帳號 | Critical | 改成 UPDATE-only policy，加 privileged-field trigger |
| `reading_logs.plan_id` 可指向另一位使用者的 plan | Critical | owner trigger + 既有資料 preflight audit |
| `UNIQUE(user_id, plan_id, ...)` 無法限制 `plan_id IS NULL` 的重複列 | High | 清理重複個人紀錄 + partial unique index |
| 舊分頁把 `current_round` 或 level 寫回舊值 | High | progress transition trigger，除明確降級外禁止倒退 |
| 計畫 end_date 早於 start_date | High | global/personal plan date CHECK |
| care reminder 已讀後可被改回未讀，或 audit 欄位被改寫 | High | reminder state-machine trigger + immutable fields |
| 公告已發布但沒有 published_at | Medium | CHECK + BEFORE trigger 自動補時間 |
| sort_order、空白名稱、空白書卷與留言 | Medium | 非負／nonblank CHECK |

## 數值邊界

- `great_regions.sort_order >= 0`
- `pastoral_zones.sort_order >= 0`
- `small_groups.sort_order >= 0`
- `reading_plans.current_round >= 1`
- `reading_logs.chapter > 0`（原 Schema 已有）
- `reading_logs.round > 0`（原 Schema 已有）
- `verse_likes.like_count >= 0`

目前 Schema 沒有金額、餘額或庫存欄位。`member_reading_summary` 的 count 是 View 聚合結果，不應額外儲存計數欄位。

## 時間與連動規則

- `global_plans.end_date >= start_date`
- `reading_plans.end_date >= start_date`
- `church_announcements.is_published = true` 時 `published_at` 不得為 NULL，且不得早於 `created_at`
- `care_reminders.read_at` 不得早於 `created_at`
- reminder 只允許 `unread → read/dismissed`，不可回到 unread
- `was_downgraded = false` 時 `downgrade_locked_until` 必須為 NULL
- `reading_logs.user_id` 必須等於被引用 `reading_plans.user_id`

## Supabase JS 併發規則

### 計數器只能使用 RPC

```js
const { data: newCount, error } = await supabase.rpc("increment_likes", {
  verse_source: verseSource
});
if (error) throw error;
```

禁止先 SELECT、在 JavaScript 做 `count + 1`、再 UPDATE。兩個客戶端同時讀到相同舊值時會造成 lost update。

NLC 模式會把相同 RPC 送到 `nlc-data`，Edge Function 只接受 `increment_likes` 與 `decrement_likes` allowlist。

### 集合型互動使用唯一鍵與 UPSERT

`devotional_likes(note_id, user_id)` 已有唯一鍵。加入按讚應使用：

```js
const { error } = await supabase
  .from("devotional_likes")
  .upsert({ note_id: noteId, user_id: profileId }, { onConflict: "note_id,user_id" });
if (error) throw error;
```

不要用「先查有沒有，再 INSERT」，因為查詢與新增之間存在 race window。

### 讀經紀錄使用冪等 UPSERT

有 plan 的讀經紀錄必須使用：

```js
const { error } = await supabase.from("reading_logs").upsert(row, {
  onConflict: "user_id,plan_id,book,chapter,round"
});
if (error) throw error;
```

個人紀錄由 partial unique index 保護；若未來要大量寫入，建議新增 SECURITY DEFINER RPC，把 personal/plan 兩種 conflict 規則包在同一個交易中。

### 多欄位狀態更新

任何「先讀 plan → 計算 → 更新 current_round/level」流程都可能被舊分頁覆蓋。0010 trigger 會拒絕非法倒退。若未來需要更一般的 optimistic concurrency，新增 `lock_version BIGINT`，UPDATE 時帶 `.eq("lock_version", expectedVersion)` 並在單一 RPC 中 `lock_version = lock_version + 1`；回傳 0 rows 就必須重新讀取，不可當成功。

## 部署注意

0010 的 CHECK 先以 `NOT VALID` 建立，再立即 `VALIDATE`。若線上已有髒資料，Migration 會以 constraint 名稱停止，必須先查出並人工確認資料，不應刪除 VALIDATE。唯一例外是 `plan_id IS NULL` 的重複 reading logs：Migration 會保留最新一筆，因為它們代表同一個冪等讀經狀態。