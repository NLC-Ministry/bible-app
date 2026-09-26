-- ============================================================================
-- 20260926155616_exam_single_paper_rehearsal.sql  —  #258（大測驗 C1）
--
-- 決定見 #257：每份考卷只有一份，狀態「草稿 → 發佈 → 結束」。拿掉測試版和
-- 「推上正式版」。管理員在草稿卷上可以實際作答（演練）。
--
-- 規則：**演練作答只存在於草稿卷上**
--   * 草稿卷上的作答標記 exam_attempts.is_test = TRUE（演練）。
--   * 發佈時清掉這份卷的演練作答 → 已發佈／已結束的卷上永遠沒有演練作答，
--     所以統計、排行榜、成績匯出等函式都不需要另外排除 is_test。
--   * 有正式作答（is_test = FALSE）時不能撤回成草稿。
--
-- 這支 migration 只改出題與作答流程；exam_papers.mode 欄位先保留（新卷一律
-- 'live'），舊的 3 份測試卷在 C2（#259）刪除、欄位在 C3（#260）刪除。
-- 以正式環境（2026-09-26 匯出）的定義為基礎修改。
-- ============================================================================

-- ── 1. 開始作答：草稿卷上的作答是演練 ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exam_start_attempt(
  p_paper_id UUID,
  p_pledge_name TEXT,
  p_reading_team_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
  pr public.exam_papers%ROWTYPE;
  at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ := NOW();
  seed TEXT;
  deadline TIMESTAMPTZ;
BEGIN
  PERFORM public._exam_close_expired_papers();
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;

  SELECT * INTO at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  IF FOUND THEN
    RETURN jsonb_build_object('attemptId', at.id, 'status', at.status, 'attemptKind', 'official', 'resumed', TRUE,
      'deadlineAt', at.deadline_at,
      'secondsRemaining', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int,
      'layout', at.layout, 'paperSnapshot', at.paper_snapshot);
  END IF;

  -- 管理員不受狀態與開放時段限制（草稿卷上即演練）。一般會友只能作答
  -- 已發佈、在開放時段內的卷；舊的測試卷（C2 刪除前）一律擋下（0113 的防護）。
  IF NOT is_staff THEN
    IF pr.mode = 'test' OR pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN
      RAISE EXCEPTION 'exam_not_open';
    END IF;
  END IF;

  IF COALESCE(TRIM(p_pledge_name), '') = '' THEN RAISE EXCEPTION 'exam_pledge_name_required'; END IF;
  seed := md5(pr.id::text || ':' || actor_id::text || ':official:' || COALESCE(pr.published_at, pr.created_at)::text);
  deadline := LEAST(now_ts + make_interval(mins => pr.duration_minutes),
                    COALESCE(pr.close_at, now_ts + make_interval(mins => pr.duration_minutes)));

  INSERT INTO public.exam_attempts(paper_id, user_id, reading_team_id, is_test, status, started_at, deadline_at,
    pledge_name, pledge_agreed_at, pledge_snapshot, layout, paper_snapshot, attempt_kind, attempt_no)
  VALUES (pr.id, actor_id, p_reading_team_id,
    -- 演練：草稿卷，或 C2 前還存在的舊測試卷
    (pr.status = 'draft' OR pr.mode = 'test'),
    'in_progress', now_ts, deadline, TRIM(p_pledge_name), now_ts,
    pr.pledge, public._exam_build_layout(pr.id, seed), public._exam_paper_snapshot(pr.id), 'official', 1)
  ON CONFLICT DO NOTHING RETURNING * INTO at;

  IF at.id IS NULL THEN
    SELECT * INTO at FROM public.exam_attempts
    WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  END IF;

  RETURN jsonb_build_object('attemptId', at.id, 'status', at.status, 'attemptKind', 'official', 'resumed', FALSE,
    'deadlineAt', at.deadline_at,
    'secondsRemaining', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int,
    'layout', at.layout, 'paperSnapshot', at.paper_snapshot);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_start_attempt(uuid, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_start_attempt(uuid, text, uuid, uuid) TO authenticated, service_role;

-- ── 2. 作答頁狀態：管理員開草稿卷 → open（可以演練）；拿掉試考名單 ───────────
CREATE OR REPLACE FUNCTION public.exam_get_for_attempt(
  p_paper_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_preview BOOLEAN DEFAULT FALSE,
  p_attempt_kind TEXT DEFAULT 'official'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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
  want_preview BOOLEAN;
BEGIN
  PERFORM public._exam_close_expired_papers();
  IF p_attempt_kind NOT IN ('official', 'practice') THEN RAISE EXCEPTION 'exam_attempt_kind_invalid'; END IF;

  IF p_paper_id IS NOT NULL THEN
    SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  ELSE
    SELECT * INTO pr FROM public.exam_papers
    WHERE (is_staff AND mode = 'live') OR (mode = 'live' AND status IN ('published', 'closed'))
    ORDER BY published_at DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'no_paper'); END IF;

  practice_end := public._exam_practice_close_at(pr.id);
  want_preview := COALESCE(p_preview, FALSE) AND is_staff;
  SELECT * INTO official_at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = 'official';
  SELECT * INTO at FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND attempt_kind = p_attempt_kind;

  IF want_preview THEN
    open_state := 'preview';                         -- 只看題目，不建作答
  ELSIF p_attempt_kind = 'practice' THEN
    IF at.id IS NOT NULL THEN
      open_state := CASE WHEN now_ts < practice_end AND pr.status IN ('published', 'closed') THEN 'open' ELSE 'closed' END;
    ELSIF pr.practice_retake_enabled AND pr.status IN ('published', 'closed') AND now_ts < practice_end
      AND official_at.id IS NOT NULL AND official_at.status <> 'in_progress' THEN
      open_state := 'practice_ready';
    ELSE
      open_state := 'not_open';
    END IF;
  ELSIF pr.mode = 'test' THEN
    -- 舊測試卷（C2 刪除前）：只有管理員進得去
    open_state := CASE WHEN NOT is_staff THEN 'not_open'
                       WHEN at.id IS NOT NULL AND at.status <> 'in_progress' THEN pr.status
                       ELSE 'open' END;
  ELSIF at.id IS NOT NULL THEN
    open_state := CASE WHEN at.status = 'in_progress' THEN 'open' ELSE pr.status END;
  ELSIF pr.status = 'draft' THEN
    open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;   -- 管理員演練
  ELSIF pr.status <> 'published' THEN
    open_state := CASE WHEN is_staff THEN 'preview' ELSE 'not_open' END;
  ELSIF now_ts < pr.open_at THEN
    open_state := 'not_open';
  ELSIF now_ts >= pr.close_at THEN
    open_state := 'closed';
  ELSE
    open_state := 'open';
  END IF;

  RETURN jsonb_build_object('state', open_state, 'preview', want_preview, 'attemptKind', p_attempt_kind,
    'paper', jsonb_build_object('id', pr.id, 'title', pr.title, 'mode', pr.mode, 'status', pr.status,
      'openAt', pr.open_at, 'closeAt', pr.close_at, 'practiceCloseAt', practice_end,
      'durationMinutes', pr.duration_minutes, 'totalPoints', pr.total_points, 'pledge', pr.pledge,
      'practiceRetakeEnabled', pr.practice_retake_enabled),
    'attempt', CASE WHEN at.id IS NULL OR want_preview THEN NULL ELSE jsonb_build_object(
      'id', at.id, 'status', at.status, 'attemptKind', at.attempt_kind, 'countsTowardScore', at.attempt_kind = 'official',
      'isRehearsal', at.is_test,
      'startedAt', at.started_at, 'deadlineAt', at.deadline_at, 'submittedAt', at.submitted_at,
      'secondsRemaining', CASE WHEN at.attempt_kind = 'practice' THEN NULL
                               ELSE GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (at.deadline_at - now_ts))))::int END,
      'layout', at.layout, 'paperSnapshot', at.paper_snapshot,
      'savedAnswers', COALESCE((SELECT jsonb_object_agg(question_id::text, response) FROM public.exam_answers
        WHERE attempt_id = at.id AND response IS NOT NULL), '{}'::jsonb),
      'autoScore', at.auto_score, 'manualScore', at.manual_score, 'totalScore', at.total_score) END,
    'officialAttemptStatus', official_at.status,
    'previewQuestions', CASE WHEN at.id IS NOT NULL AND NOT want_preview THEN NULL ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', q.id, 'section', q.section, 'position', q.position,
        'points', q.points, 'payload', public._exam_public_payload(q.section, q.payload, q.points))
      ORDER BY q.section, q.position) FROM public.exam_questions q WHERE q.paper_id = pr.id), '[]'::jsonb) END);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) TO authenticated, service_role;

-- ── 3. 發佈：先清掉這份卷的演練作答 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.exam_publish(p_paper_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr public.exam_papers%ROWTYPE;
  sec TEXT; want INTEGER; got INTEGER;
  enabled_types TEXT[];
  cleared INTEGER;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status <> 'draft' THEN RAISE EXCEPTION 'exam_already_published'; END IF;
  IF pr.mode = 'live' AND NOT pr.announcement_published THEN RAISE EXCEPTION 'exam_not_announced'; END IF;
  IF pr.open_at IS NULL OR pr.close_at IS NULL OR pr.close_at <= pr.open_at OR pr.close_at <= NOW() THEN
    RAISE EXCEPTION 'exam_window_invalid';
  END IF;
  IF COALESCE(jsonb_array_length(pr.sections), 0) = 0 THEN RAISE EXCEPTION 'exam_no_sections'; END IF;
  SELECT array_agg(e ->> 'type') INTO enabled_types FROM jsonb_array_elements(pr.sections) e;
  FOR sec, want IN SELECT e ->> 'type', (e ->> 'count')::int FROM jsonb_array_elements(pr.sections) e LOOP
    SELECT COUNT(*) INTO got FROM public.exam_questions WHERE paper_id = pr.id AND section = sec;
    IF got <> want THEN RAISE EXCEPTION 'exam_section_count_mismatch: % expected % got %', sec, want, got; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.exam_questions WHERE paper_id = pr.id AND NOT (section = ANY (enabled_types))) THEN
    RAISE EXCEPTION 'exam_section_not_enabled';
  END IF;

  -- 草稿期間的演練作答（連帶答案、批改、通知）在發佈前清掉，會友看到的是乾淨的卷，
  -- 管理員發佈後也能再正式作答一次。
  DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;
  GET DIAGNOSTICS cleared = ROW_COUNT;

  UPDATE public.exam_papers SET status = 'published', published_at = NOW(), published_by = actor_id,
    closed_at = NULL, closed_by = NULL, close_reason = NULL
  WHERE id = pr.id;

  RETURN jsonb_build_object('paperId', pr.id, 'status', 'published',
    'answerKeysComplete', public._exam_keys_complete(pr.id),
    'clearedRehearsalAttempts', cleared);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_publish(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_publish(uuid, uuid) TO authenticated, service_role;

-- ── 4. 狀態切換：有正式作答就不能撤回成草稿；草稿要發佈只能走 exam_publish ───
CREATE OR REPLACE FUNCTION public.exam_set_status(p_paper_id UUID, p_status TEXT, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  IF p_status NOT IN ('draft', 'published', 'closed') THEN RAISE EXCEPTION 'exam_status_invalid'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;

  IF p_status = 'closed' THEN
    RETURN public._exam_close_paper(p_paper_id, 'manual', actor_id);
  END IF;
  -- 草稿 → 發佈要經過 exam_publish 的檢查，也要清掉演練作答
  IF p_status = 'published' AND pr.status = 'draft' THEN
    RAISE EXCEPTION 'exam_use_publish';
  END IF;
  -- 撤回成草稿：已經有人正式作答就不行（演練作答不算）
  IF p_status = 'draft' AND pr.status <> 'draft' AND EXISTS (
    SELECT 1 FROM public.exam_attempts WHERE paper_id = pr.id AND NOT is_test
  ) THEN
    RAISE EXCEPTION 'exam_revert_has_attempts';
  END IF;

  UPDATE public.exam_papers SET status = p_status,
    closed_at = CASE WHEN p_status = 'draft' THEN NULL ELSE closed_at END,
    closed_by = CASE WHEN p_status = 'draft' THEN NULL ELSE closed_by END,
    close_reason = CASE WHEN p_status = 'draft' THEN NULL ELSE close_reason END
  WHERE id = p_paper_id;
  RETURN jsonb_build_object('paperId', p_paper_id, 'status', p_status);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_set_status(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_set_status(uuid, text, uuid) TO authenticated, service_role;

-- ── 5. 清除作答紀錄：只有草稿卷（演練）可以；舊測試卷在 C2 前也可以 ──────────
CREATE OR REPLACE FUNCTION public.exam_reset_attempts(p_paper_id UUID, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  pr        public.exam_papers%ROWTYPE;
  n_deleted INTEGER;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  IF pr.status <> 'draft' AND pr.mode <> 'test' THEN RAISE EXCEPTION 'exam_reset_live_forbidden'; END IF;
  IF pr.results_published_at IS NOT NULL THEN RAISE EXCEPTION 'exam_results_locked'; END IF;

  DELETE FROM public.exam_attempts WHERE paper_id = pr.id;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  RETURN jsonb_build_object('paperId', pr.id, 'deletedAttempts', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_reset_attempts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_reset_attempts(uuid, uuid) TO authenticated, service_role;

-- ── 6. 建立／修改試卷：新卷一律 'live'，不再接受修改 mode ──────────────────
CREATE OR REPLACE FUNCTION public.exam_upsert_paper(p_payload JSONB, p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_paper_id UUID := NULLIF(p_payload ->> 'id', '')::uuid;
  v_sections JSONB := p_payload -> 'sections';
  v_has_plan BOOLEAN := p_payload ? 'linked_plan_id';
  v_plan_id  UUID := NULLIF(p_payload ->> 'linked_plan_id', '')::uuid;
  row_out    public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  IF v_plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.global_plans WHERE id = v_plan_id) THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  IF v_paper_id IS NULL THEN
    IF v_sections IS NULL THEN
      v_sections := jsonb_build_array(
        jsonb_build_object('type','truefalse','count',20,'pointsPer',1),
        jsonb_build_object('type','single','count',20,'pointsPer',1),
        jsonb_build_object('type','multiple','count',10,'pointsPer',1),
        jsonb_build_object('type','matching','count',10,'pointsPer',1),
        jsonb_build_object('type','ordering','count',10,'pointsPer',1),
        jsonb_build_object('type','shortanswer','count',3,'pointsPer',10));
    END IF;
    INSERT INTO public.exam_papers (title, description, mode, open_at, close_at,
        duration_minutes, total_points, pledge, sections, section_targets, linked_plan_id, created_by)
    VALUES (
      COALESCE(NULLIF(p_payload ->> 'title', ''), '速讀測驗'),
      COALESCE(p_payload ->> 'description', ''),
      'live',                                   -- 不再有測試版（#257）
      NULLIF(p_payload ->> 'open_at', '')::timestamptz,
      NULLIF(p_payload ->> 'close_at', '')::timestamptz,
      COALESCE((p_payload ->> 'duration_minutes')::smallint, 75),
      GREATEST(public._exam_sections_total(v_sections)::smallint, 1),
      COALESCE(p_payload -> 'pledge', jsonb_build_object('openText','', 'rules','[]'::jsonb, 'consentTemplate','')),
      v_sections,
      public._exam_sections_targets(v_sections),
      v_plan_id,
      actor_id)
    RETURNING * INTO row_out;
  ELSE
    UPDATE public.exam_papers SET
      title = COALESCE(NULLIF(p_payload ->> 'title', ''), title),
      description = COALESCE(p_payload ->> 'description', description),
      open_at = COALESCE(NULLIF(p_payload ->> 'open_at', '')::timestamptz, open_at),
      close_at = COALESCE(NULLIF(p_payload ->> 'close_at', '')::timestamptz, close_at),
      duration_minutes = COALESCE((p_payload ->> 'duration_minutes')::smallint, duration_minutes),
      pledge = COALESCE(p_payload -> 'pledge', pledge),
      sections = COALESCE(v_sections, sections),
      section_targets = CASE WHEN v_sections IS NOT NULL
                             THEN public._exam_sections_targets(v_sections) ELSE section_targets END,
      total_points = CASE WHEN v_sections IS NOT NULL
                          THEN GREATEST(public._exam_sections_total(v_sections)::smallint, 1)
                          ELSE COALESCE((p_payload ->> 'total_points')::smallint, total_points) END,
      linked_plan_id = CASE WHEN v_has_plan THEN v_plan_id ELSE linked_plan_id END
    WHERE id = v_paper_id AND status = 'draft'
    RETURNING * INTO row_out;
    IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;
  END IF;

  RETURN to_jsonb(row_out);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_upsert_paper(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_upsert_paper(jsonb, uuid) TO authenticated, service_role;

-- ── 7. 不再使用的函式：收回 client 可呼叫的權限（函式本身在 C3 刪除）───────
-- 新後台不再呼叫這些；nlc-data 的允許清單也同步移除。只留 service_role，
-- 讓部署新前端前還在用舊後台的管理員不會立刻壞掉。
REVOKE ALL ON FUNCTION public.exam_push_to_live(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_push_to_live(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.exam_set_mode(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_set_mode(uuid, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.exam_add_tester(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_add_tester(uuid, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.exam_remove_tester(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_remove_tester(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.exam_get_paper_testers(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_get_paper_testers(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public._exam_can_access_test(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_can_access_test(uuid, uuid) TO service_role;
