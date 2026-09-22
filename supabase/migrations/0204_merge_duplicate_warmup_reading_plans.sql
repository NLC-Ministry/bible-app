-- 一次性資料清理：合併熱身賽（第1階段｜第一輪熱身賽）底下重複的 reading_plans。
--
-- 背景：db.js joinPresetPlan()（修正前）判斷「是否已加入」時只查
-- global_plan_id，沒有同時查 preset_key。任何人在 global_plan_id 補上之前用
-- 舊制加入過熱身賽，之後只要再觸發一次加入流程、這次 globalPlanId 解析出來
-- 了，就會被誤判成「沒加入過」而多 INSERT 一筆——同一個人對熱身賽留下兩筆
-- reading_plans，讀經紀錄依當下 state.activePlan 指到哪一筆就寫去哪一筆，
-- 進度因此被撕裂或重複，也讓「完成計畋人數」等統計嚴重低估。db.js 的成因已
-- 在別的 commit 修掉（改成同時查兩個條件），這支 migration 只處理已經產生的
-- 歷史髒資料。
--
-- 已用唯讀診斷查詢確認範圍：全教會目前有且只有 58 組重複，全部、只有、清一
-- 色都是熱身賽（target_books = ['創世記']），沒有擴散到其他 church_campaign_
-- stage 階段。
--
-- 合併規則：
--   1. 正本（canonical）＝ global_plan_id 已經指到熱身賽 UUID
--      （00000000-0000-0000-c026-000000000001）的那一筆；如果兩筆都沒有
--      global_plan_id（理論上不會發生，這裡當防呆），用較新建立的那一筆。
--   2. 副本（loser）的 reading_logs，凡是正本還沒有的 (book, chapter, round)
--      組合，直接把 plan_id 改指到正本（不會遺失任何一邊的讀經紀錄）。
--   3. 副本裡跟正本「完全撞號」的紀錄（正本已經有同一組 book/chapter/round），
--      視為重複打卡，直接刪掉副本那筆——不會覆蓋、也不會兩邊都留著造成真正
--      的資料重複。
--   4. current_round 取兩筆的較大值、upgrade_prompt_handled 只要任一筆是
--      true 就視為 true，合併寫回正本，避免任何一邊的既有進度被較低的另一
--      邊蓋掉。
--   5. 副本的 reading_logs 清空後，刪掉副本這筆 reading_plans。
--
-- 只鎖定「target_books 剛好是 ['創世記']，且 global_plan_id 是熱身賽 UUID
-- 或是 NULL」的列，不會動到任何使用者自己另外建立、剛好也只讀創世記的自訂
-- 計畋（那種通常 global_plan_id 是別的值或本來就沒有重複）。
DO $$
DECLARE
  warmup_plan_id CONSTANT UUID := '00000000-0000-0000-c026-000000000001'::UUID;
  rec RECORD;
  ordered_ids UUID[];
  canonical_id UUID;
  loser_id UUID;
  moved_count INTEGER;
  dropped_count INTEGER;
  affected_users INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      user_id,
      ARRAY_AGG(id ORDER BY (global_plan_id = warmup_plan_id) DESC, created_at DESC) AS ids,
      MAX(current_round) AS merged_round,
      BOOL_OR(upgrade_prompt_handled) AS merged_upgrade
    FROM public.reading_plans
    WHERE target_books = ARRAY['創世記']::TEXT[]
      AND (global_plan_id = warmup_plan_id OR global_plan_id IS NULL)
    GROUP BY user_id
    HAVING COUNT(*) = 2
  LOOP
    ordered_ids := rec.ids;
    canonical_id := ordered_ids[1];
    loser_id := ordered_ids[2];

    -- 副本裡正本還沒有的紀錄，搬到正本
    UPDATE public.reading_logs AS loser_log
    SET plan_id = canonical_id
    WHERE loser_log.plan_id = loser_id
      AND NOT EXISTS (
        SELECT 1 FROM public.reading_logs AS existing
        WHERE existing.plan_id = canonical_id
          AND existing.book = loser_log.book
          AND existing.chapter = loser_log.chapter
          AND existing.round = loser_log.round
      );
    GET DIAGNOSTICS moved_count = ROW_COUNT;

    -- 剩下跟正本完全撞號的，當重複打卡直接丟棄
    DELETE FROM public.reading_logs WHERE plan_id = loser_id;
    GET DIAGNOSTICS dropped_count = ROW_COUNT;

    UPDATE public.reading_plans
    SET current_round = rec.merged_round,
        upgrade_prompt_handled = rec.merged_upgrade
    WHERE id = canonical_id;

    DELETE FROM public.reading_plans WHERE id = loser_id;

    affected_users := affected_users + 1;
    RAISE NOTICE '[warmup-merge] user %: canonical=%, loser=%, moved_logs=%, dropped_dupe_logs=%, merged_round=%',
      rec.user_id, canonical_id, loser_id, moved_count, dropped_count, rec.merged_round;
  END LOOP;

  RAISE NOTICE '[warmup-merge] done: % users merged', affected_users;
END $$;
