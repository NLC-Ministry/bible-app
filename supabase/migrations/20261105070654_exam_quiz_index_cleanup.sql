-- ============================================================================
-- #675 補缺少的索引、刪重複的索引（這支只動索引，不動任何函式）
--
-- 【鎖與影響】supabase db push 在交易內執行，不能用 CREATE INDEX CONCURRENTLY：
--   - CREATE INDEX 會擋被建索引那張表的寫入（SHARE 鎖），讀取不受影響；鎖一路持有到整支 commit。
--   - DROP INDEX 會短暫擋該表的讀寫（ACCESS EXCLUSIVE），本身是瞬間完成，但一樣持有到 commit。
--   這幾張表都不大（staging 查到：reading_teams 158 列、quiz_publications 915 列、exam_attempts 230 列、
--   exam_answers 約 1.1 萬列；正式站沒查，預期同一個量級），整支預估 1 秒內跑完，期間的寫入只是稍等，不會失敗。
--   建議在沒有大考作答的離峰時段套用（台灣時間深夜到清晨）：大考進行中 exam_answers／exam_attempts 寫入最密集。
--   萬一撞到死結，整支會 rollback，重跑即可。
--   這支沒有動 reading_logs，打卡熱路徑不受影響。
--
-- 【新增】
--   quiz_publications (quiz_id)：外鍵沒有索引。update_daily_quiz_questions、swap_daily_quiz_version、
--     set_daily_quiz_answer_key、request_daily_quiz_regeneration，以及刪 daily_quizzes 時的外鍵檢查都要用。
--   reading_teams (carried_from_team_id)：帶隊鏈往下走（admin_api_team_lineage、admin_api_team_detail、
--     exam_get_my_result 等）。既有的唯一索引開頭是 global_plan_id，用不上。
--   exam_attempts (paper_id) WHERE is_test：_exam_close_expired_papers 每分鐘刪試作列，平常幾乎沒有試作，
--     部分索引讓這段不用掃整張作答表。
--   exam_attempts (official_attempt_id)：外鍵 ON DELETE CASCADE；刪一筆作答時要找它的重作練習。
--
-- 【刪除】以下六顆的欄位，都被同一張表的唯一約束完全涵蓋（相同或剛好是開頭欄位）。
--   全部是非唯一索引，所以不可能是外鍵參照或 ON CONFLICT 的目標（兩者都只認唯一索引）。
--   staging 的 pg_indexes 查過，定義跟 migration 跑完的結果相同；正式站沒查，所以每顆都先確認
--   涵蓋它的唯一索引存在才刪，萬一環境有差異就留著，不會造成少了索引。
--
-- 【刻意不動】
--   reading_logs BRIN(read_at)：BRIN 要實體順序跟 read_at 相關才有用，staging 的 correlation 只有 0.03
--     （匯入的樣本資料，不代表正式站），無法確認會被用到；而且要擋打卡寫入。先查正式站 correlation 再決定。
--   reading_teams (captain_id)：只有合併帳號、刪 profile 這種罕見操作用到，表又小，不值得多一顆索引。
--   idx_reading_logs_user_plan、idx_reading_plans_global_plan_id、idx_exam_attempts_paper_status、
--   idx_issue_reports_created_at：沒有被完全涵蓋（#400 量過 planner 偏好較小的索引），沒有正式站 EXPLAIN 不動。
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_quiz_publications_quiz_id
  ON public.quiz_publications (quiz_id);

CREATE INDEX IF NOT EXISTS idx_reading_teams_carried_from_team_id
  ON public.reading_teams (carried_from_team_id)
  WHERE carried_from_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exam_attempts_paper_is_test
  ON public.exam_attempts (paper_id)
  WHERE is_test;

CREATE INDEX IF NOT EXISTS idx_exam_attempts_official_attempt_id
  ON public.exam_attempts (official_attempt_id)
  WHERE official_attempt_id IS NOT NULL;

DO $$
DECLARE
  v_pair RECORD;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      -- 欄位完全相同
      ('idx_exam_questions_paper', 'exam_questions_paper_id_section_position_key'),
      ('idx_quiz_publications_plan_date_group', 'quiz_publications_global_plan_id_quiz_date_small_group_id_key'),
      -- 剛好是唯一約束的開頭欄位
      ('idx_exam_answers_attempt', 'exam_answers_attempt_id_question_id_key'),
      ('idx_lightning_quiz_attempts_question', 'lightning_quiz_attempts_question_id_user_id_key'),
      ('idx_verse_notes_user_chapter', 'verse_notes_user_id_book_chapter_verse_key'),
      ('idx_highlights_user_chapter', 'highlights_user_id_book_chapter_verse_key')
    ) AS t(duplicate_index, covering_index)
  LOOP
    IF to_regclass('public.' || v_pair.covering_index) IS NOT NULL THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', v_pair.duplicate_index);
    ELSE
      RAISE WARNING '#675: % 不存在，保留 %', v_pair.covering_index, v_pair.duplicate_index;
    END IF;
  END LOOP;
END $$;
