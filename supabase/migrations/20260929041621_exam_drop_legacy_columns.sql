-- #303 [exam R6] 清理大測驗新流程用不到的舊欄位與函式（#297 第 4 批）。
--
-- 新流程（#298～#302）上線後，這些東西已經沒有任何地方讀寫：
--   * exam_papers.announcement_published / pre_announcement / pre_announcement_enabled：
--     首頁卡片改成排程後自動出現（#298），不再有「發佈預告文」這一步。
--     exam_papers.announcement 保留，是首頁卡片文字。
--   * exam_papers.auto_score_enabled：收卷一律計分、修正正解自動重算（#299）。
--   * exam_publish_announcement / exam_unpublish_announcement / exam_save_pre_announcement /
--     exam_set_auto_score：前端從 #299、#301 起就不再呼叫，nlc-data allowlist 同步移除。
--   * exam_get_for_attempt 的預覽模式：後台「預覽試卷」已由「試作」取代（#302）。
--     順帶修掉一個外洩：沒有作答紀錄時，previewQuestions 會把整份題目（不含正解）
--     回傳給任何會友——包括還沒開放作答的試卷。p_preview 參數保留在簽名裡（直接忽略），
--     讓還沒更新的舊前端照樣能呼叫。
--
-- 舊前端相容性：舊版只有管理員會呼叫被刪的四支函式（會友路徑不受影響），
-- 管理員重新整理就會拿到新版，不需要設 forceUpdateBuiltBefore。
--
-- announced_at / announced_by 只剩被刪的 exam_publish_announcement 會寫入，
-- 不在 #303 範圍內，這次先不刪。

-- ── 1. 刪函式 ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.exam_publish_announcement(uuid, uuid);
DROP FUNCTION IF EXISTS public.exam_unpublish_announcement(uuid, uuid);
DROP FUNCTION IF EXISTS public.exam_save_pre_announcement(uuid, jsonb, boolean, uuid);
DROP FUNCTION IF EXISTS public.exam_set_auto_score(uuid, boolean, uuid);

-- ── 2. 作答入口拿掉預覽模式 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exam_get_for_attempt(p_paper_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid, p_preview boolean DEFAULT false, p_attempt_kind text DEFAULT 'official'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
  pr public.exam_papers%ROWTYPE;
  at public.exam_attempts%ROWTYPE;
  official_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ := NOW();
  practice_end TIMESTAMPTZ;
  open_state TEXT;
BEGIN
  -- p_preview 已不使用（#303），保留參數只為了舊前端相容。
  PERFORM public._exam_close_expired_papers();
  IF p_attempt_kind NOT IN ('official', 'practice') THEN RAISE EXCEPTION 'exam_attempt_kind_invalid'; END IF;

  IF p_paper_id IS NOT NULL THEN
    SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  ELSE
    SELECT * INTO pr FROM public.exam_papers
    WHERE is_staff OR status IN ('published', 'closed')
    ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'no_paper'); END IF;

  practice_end := public._exam_practice_close_at(pr.id);
  SELECT * INTO official_at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  SELECT * INTO at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = p_attempt_kind;

  IF p_attempt_kind = 'practice' THEN
    IF at.id IS NOT NULL THEN
      open_state := CASE WHEN now_ts < practice_end AND pr.status IN ('published', 'closed') THEN 'open' ELSE 'closed' END;
    ELSIF pr.practice_retake_enabled AND pr.status IN ('published', 'closed') AND now_ts < practice_end
      AND official_at.id IS NOT NULL AND official_at.status <> 'in_progress' THEN
      open_state := 'practice_ready';
    ELSE
      open_state := 'not_open';
    END IF;
  ELSIF at.id IS NOT NULL THEN
    open_state := CASE WHEN at.status = 'in_progress' THEN 'open' ELSE pr.status END;
  ELSIF pr.status = 'draft' OR (pr.status = 'published' AND now_ts < pr.open_at) THEN
    open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;   -- 管理員試作（準備中、已排程）
  ELSIF pr.status <> 'published' THEN
    open_state := CASE WHEN is_staff THEN 'closed' ELSE 'not_open' END; -- 以前管理員會落到預覽狀態
  ELSIF now_ts >= pr.close_at THEN
    open_state := 'closed';
  ELSE
    open_state := 'open';
  END IF;

  RETURN jsonb_build_object('state', open_state, 'attemptKind', p_attempt_kind,
    'paper', jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status,
      'stage', public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at),
      'openAt', pr.open_at, 'closeAt', pr.close_at, 'practiceCloseAt', practice_end,
      'durationMinutes', pr.duration_minutes, 'totalPoints', pr.total_points, 'pledge', pr.pledge,
      'practiceRetakeEnabled', pr.practice_retake_enabled),
    'attempt', CASE WHEN at.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', at.id, 'status', at.status, 'attemptKind', at.attempt_kind, 'countsTowardScore', at.attempt_kind = 'official',
      'isRehearsal', at.is_test,
      'startedAt', at.started_at, 'deadlineAt', at.deadline_at, 'submittedAt', at.submitted_at,
      'secondsRemaining', CASE WHEN at.attempt_kind = 'practice' THEN NULL
                               ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int END,
      'layout', at.layout, 'paperSnapshot', at.paper_snapshot,
      'savedAnswers', COALESCE((SELECT jsonb_object_agg(question_id::text, response) FROM public.exam_answers
        WHERE attempt_id = at.id AND response IS NOT NULL), '{}'::jsonb),
      'autoScore', at.auto_score, 'manualScore', at.manual_score, 'totalScore', at.total_score) END,
    'officialAttemptStatus', official_at.status);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) TO authenticated, service_role;

-- ── 3. 刪欄位 ──────────────────────────────────────────────────────────────
-- 不加 CASCADE：萬一還有 view / policy 依賴這些欄位，寧可 migration 失敗也不要默默連帶刪掉。
ALTER TABLE public.exam_papers
  DROP COLUMN IF EXISTS announcement_published,
  DROP COLUMN IF EXISTS pre_announcement,
  DROP COLUMN IF EXISTS pre_announcement_enabled,
  DROP COLUMN IF EXISTS auto_score_enabled;
