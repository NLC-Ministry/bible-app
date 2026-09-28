-- ============================================================================
-- 20260928031148_exam_schedule_shows_home_card.sql  —  #298（大測驗 R1，屬於 #297）
--
-- 新流程：① 準備中 → ② 已排程 → ③ 作答中 → ④ 批改中 → ⑤ 已公布
-- 階段由現有欄位推算（新 helper _exam_paper_stage），不加欄位：
--   ① status='draft'
--   ② status='published' AND now() < open_at
--   ③ status='published' AND now() >= open_at（截止後由 exam-auto-close 每分鐘轉成 closed）
--   ④ status='closed' AND results_published_at IS NULL
--   ⑤ results_published_at IS NOT NULL
--
-- 這支 migration 做的事：
--   1. 「排程」（exam_publish）不再要求先發佈預告文；排程後首頁卡片就自動出現。
--      首頁 / 我的測驗一律只看 status IN ('published','closed')，草稿永遠不顯示。
--      announcement_published、pre_announcement_* 不再讀取（#303 才刪欄位）。
--   2. 首頁卡片文字沒填時自動產生：標題 → 試卷標題；說明 → 開放／截止時間與限時。
--   3. ② 已排程時題目仍可修改（exam_upsert_paper / exam_upsert_question）。
--      但題目「結構」鎖定：不能新增、刪除題目，不能改題型題數——排程時才驗證過
--      題數，開放時沒有地方再檢查一次。要改結構請先「取消排程」回到 ①。
--   4. 「取消排程」（exam_set_status → 'draft'）只在 ② 可用；開放作答後不能回頭。
--      ② 也不能直接「關閉」（應該用取消排程）。
--   5. 試作（is_test）：① 和 ② 管理員都能試作；開放作答時由 _exam_close_expired_papers
--      （exam-auto-close 每分鐘）清掉該卷所有試作，會友開考時看到的是乾淨的卷。
--   6. exam_get_paper_admin 多回傳 stage、serverNow，後台不用自己用裝置時間推算階段。
--
-- 刻意不動：
--   - exam_set_answer_key：維持「成績公布前都能改正解」，④ 批改中要能修正正解（#299）。
--   - exam_set_question_explanation：答案詳解維持任何階段都能補寫。
--   - 統計、批改清單排除 is_test：試作只存在 ① ②、開放時就清掉，③ 之後本來就沒有試作；
--     ① 的完整演練（含批改、統計）改成「試作」的規則在 #302 一起處理。
--
-- 沒有新增 RPC，nlc-data allowlist 不用改；舊版前端呼叫的函式都還在、行為相容，
-- 不需要 forceUpdateBuiltBefore。
-- ============================================================================

-- ── 0. 階段 helper ──
CREATE OR REPLACE FUNCTION public._exam_paper_stage(
  p_status TEXT, p_open_at TIMESTAMPTZ, p_results_published_at TIMESTAMPTZ
) RETURNS TEXT
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN p_results_published_at IS NOT NULL THEN 'published'
    WHEN p_status = 'draft' THEN 'preparing'
    WHEN p_status = 'published' AND (p_open_at IS NULL OR NOW() < p_open_at) THEN 'scheduled'
    WHEN p_status = 'published' THEN 'open'
    ELSE 'grading'
  END
$$;
REVOKE ALL ON FUNCTION public._exam_paper_stage(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_paper_stage(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- 首頁卡片的預設說明：「10/25（六）09:00 開放，至 10/26（日）21:00 截止；作答限時 75 分鐘。」
CREATE OR REPLACE FUNCTION public._exam_default_card_body(
  p_open_at TIMESTAMPTZ, p_close_at TIMESTAMPTZ, p_duration_minutes INTEGER
) RETURNS TEXT
  LANGUAGE sql STABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE WHEN p_open_at IS NULL OR p_close_at IS NULL THEN '' ELSE
    to_char(p_open_at AT TIME ZONE 'Asia/Taipei', 'FMMM/FMDD')
      || '（' || (ARRAY['日','一','二','三','四','五','六'])[EXTRACT(DOW FROM p_open_at AT TIME ZONE 'Asia/Taipei')::int + 1] || '）'
      || to_char(p_open_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') || ' 開放，至 '
      || to_char(p_close_at AT TIME ZONE 'Asia/Taipei', 'FMMM/FMDD')
      || '（' || (ARRAY['日','一','二','三','四','五','六'])[EXTRACT(DOW FROM p_close_at AT TIME ZONE 'Asia/Taipei')::int + 1] || '）'
      || to_char(p_close_at AT TIME ZONE 'Asia/Taipei', 'HH24:MI') || ' 截止'
      || CASE WHEN p_duration_minutes IS NOT NULL AND p_duration_minutes > 0
              THEN '；作答限時 ' || p_duration_minutes || ' 分鐘。' ELSE '。' END
  END
$$;
REVOKE ALL ON FUNCTION public._exam_default_card_body(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_default_card_body(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO service_role;

-- ── 1. 排程：不再要求先發佈預告文 ──
CREATE OR REPLACE FUNCTION public.exam_publish(p_paper_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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

  -- 準備中的試作（連帶答案、批改、通知）在排程時清掉；排程後還能再試作，
  -- 開放作答時由 _exam_close_expired_papers 再清一次。
  DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;
  GET DIAGNOSTICS cleared = ROW_COUNT;

  UPDATE public.exam_papers SET status = 'published', published_at = NOW(), published_by = actor_id,
    closed_at = NULL, closed_by = NULL, close_reason = NULL
  WHERE id = pr.id;

  RETURN jsonb_build_object('paperId', pr.id, 'status', 'published', 'stage', 'scheduled',
    'answerKeysComplete', public._exam_keys_complete(pr.id),
    'clearedRehearsalAttempts', cleared);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_publish(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_publish(uuid, uuid) TO authenticated, service_role;

-- ── 4. 取消排程只在 ②；② 不能直接關閉 ──
CREATE OR REPLACE FUNCTION public.exam_set_status(p_paper_id uuid, p_status text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr public.exam_papers%ROWTYPE;
  stage TEXT;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  IF p_status NOT IN ('draft', 'published', 'closed') THEN RAISE EXCEPTION 'exam_status_invalid'; END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = p_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  stage := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at);

  IF p_status = 'closed' THEN
    -- 還沒開放就「關閉」會變成一份沒人能作答的卷；② 請用「取消排程」。
    IF stage = 'scheduled' THEN RAISE EXCEPTION 'exam_use_unschedule'; END IF;
    RETURN public._exam_close_paper(p_paper_id, 'manual', actor_id);
  END IF;
  -- 準備中 → 已排程要經過 exam_publish 的檢查
  IF p_status = 'published' AND pr.status = 'draft' THEN
    RAISE EXCEPTION 'exam_use_publish';
  END IF;
  -- 取消排程：只有 ② 已排程（還沒開放作答）可以
  IF p_status = 'draft' AND pr.status <> 'draft' AND stage <> 'scheduled' THEN
    RAISE EXCEPTION 'exam_already_open';
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

-- ── 5. 開放作答時清掉試作（exam-auto-close 每分鐘執行，其他 RPC 開頭也會先呼叫）──
CREATE OR REPLACE FUNCTION public._exam_close_expired_papers()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE r RECORD;n INTEGER:=0;
BEGIN
  -- 已經開放作答（或已結束）的卷上不該再有試作：會友看到乾淨的卷，
  -- 試作過的管理員也能再正式作答一次（正式作答一人一份）。
  DELETE FROM public.exam_attempts a USING public.exam_papers pr
  WHERE a.paper_id=pr.id AND a.is_test AND pr.status IN('published','closed')
    AND pr.open_at IS NOT NULL AND pr.open_at<=NOW();

  FOR r IN SELECT id FROM public.exam_papers
    WHERE status='published' AND close_at IS NOT NULL AND close_at<=NOW()
    FOR UPDATE SKIP LOCKED LOOP
    PERFORM public._exam_close_paper(r.id,'scheduled',NULL);
    n:=n+1;
  END LOOP;
  UPDATE public.exam_attempts a SET status='submitted',submitted_at=COALESCE(a.submitted_at,NOW()),
    submit_reason='auto_close',practice_completed_at=COALESCE(a.practice_completed_at,NOW())
  FROM public.exam_papers pr
  WHERE a.paper_id=pr.id AND a.attempt_kind='practice' AND a.status='in_progress'
    AND pr.close_at IS NOT NULL AND NOW()>=pr.close_at+INTERVAL '1 day';
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public._exam_close_expired_papers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exam_close_expired_papers() TO service_role;

-- ── 1 + 2. 首頁卡片：排程後就顯示、草稿永遠不顯示；文字沒填時自動產生 ──
CREATE OR REPLACE FUNCTION public._exam_member_paper_summary(p_paper_id uuid, p_actor_id uuid, p_is_staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE pr public.exam_papers%ROWTYPE;official_at public.exam_attempts%ROWTYPE;practice_at public.exam_attempts%ROWTYPE;
  now_ts TIMESTAMPTZ:=NOW();practice_end TIMESTAMPTZ;in_window BOOLEAN:=FALSE;
  can_enter BOOLEAN:=FALSE;can_practice BOOLEAN:=FALSE;result_ready BOOLEAN:=FALSE;
  disp_headline TEXT;disp_body TEXT;
BEGIN
  SELECT * INTO pr FROM public.exam_papers WHERE id=p_paper_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  practice_end:=public._exam_practice_close_at(pr.id);
  SELECT * INTO official_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='official' AND NOT is_test;
  SELECT * INTO practice_at FROM public.exam_attempts WHERE paper_id=pr.id AND user_id=p_actor_id AND attempt_kind='practice' AND NOT is_test;
  in_window:=pr.open_at IS NOT NULL AND pr.close_at IS NOT NULL AND now_ts>=pr.open_at AND now_ts<pr.close_at;
  can_enter:=official_at.id IS NULL AND pr.status='published' AND in_window;
  can_practice:=pr.practice_retake_enabled AND pr.status IN('published','closed') AND now_ts<practice_end
    AND official_at.id IS NOT NULL AND official_at.status<>'in_progress';
  result_ready:=official_at.status='graded' AND(pr.results_published_at IS NOT NULL OR p_is_staff);
  -- 首頁卡片文字：有填用填的，沒填用試卷標題／開放時間自動產生（預告已退場，不再讀）
  disp_headline:=COALESCE(NULLIF(btrim(pr.announcement->>'headline'),''),pr.title);
  disp_body:=COALESCE(NULLIF(btrim(pr.announcement->>'body'),''),
    public._exam_default_card_body(pr.open_at,pr.close_at,pr.duration_minutes));
  RETURN jsonb_build_object('paperId',pr.id,'title',pr.title,'status',pr.status,
    'stage',public._exam_paper_stage(pr.status,pr.open_at,pr.results_published_at),
    'headline',COALESCE(disp_headline,''),'body',COALESCE(disp_body,''),
    'isPreAnnouncement',FALSE,
    'ctaLabel',COALESCE(NULLIF(pr.announcement->>'ctaLabel',''),'進入測驗'),'openAt',pr.open_at,
    'closeAt',pr.close_at,'practiceCloseAt',practice_end,'durationMinutes',pr.duration_minutes,
    'serverNow',now_ts,'inWindow',in_window,'canEnter',can_enter,'myAttemptStatus',official_at.status,
    'officialAttemptId',official_at.id,'canReviewOfficial',official_at.id IS NOT NULL AND official_at.status<>'in_progress',
    'canPractice',can_practice,'practiceAttemptId',practice_at.id,'practiceAttemptStatus',practice_at.status,
    'practiceReviewReady',practice_at.id IS NOT NULL,'resultReady',result_ready,
    'resultsPublishedAt',pr.results_published_at,
    'myTotalScore',CASE WHEN result_ready THEN official_at.total_score ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public._exam_member_paper_summary(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._exam_member_paper_summary(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_home_exams(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam') THEN RETURN '[]'::jsonb; END IF;
  PERFORM public._exam_close_expired_papers();

  RETURN COALESCE((
    SELECT jsonb_agg(public._exam_member_paper_summary(pr.id, actor_id, is_staff)
      ORDER BY
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.status = 'published' AND NOW() < pr.open_at) DESC,
        pr.open_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    WHERE pr.status IN ('published', 'closed')
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_home_exams(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_home_exams(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_home_banner(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);is_staff BOOLEAN:=public._exam_actor_role(actor_id)IN('admin','pastor');
  paper_id UUID;
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam')THEN RETURN NULL; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT pr.id INTO paper_id FROM public.exam_papers pr
  WHERE pr.status IN ('published', 'closed')
  ORDER BY pr.published_at DESC NULLS LAST,pr.created_at DESC LIMIT 1;
  IF paper_id IS NULL THEN RETURN NULL; END IF;
  RETURN public._exam_member_paper_summary(paper_id,actor_id,is_staff);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_home_banner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_home_banner(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_my_papers(p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  is_staff BOOLEAN := public._exam_actor_role(actor_id) IN ('admin', 'pastor');
BEGIN
  IF NOT public.is_feature_enabled('speed_reading_exam') THEN RETURN '[]'::jsonb; END IF;
  PERFORM public._exam_close_expired_papers();

  RETURN COALESCE((
    SELECT jsonb_agg(public._exam_member_paper_summary(pr.id, actor_id, is_staff)
      ORDER BY
        (oa.status = 'in_progress') DESC,
        (pr.status = 'published' AND NOW() >= pr.open_at AND NOW() < pr.close_at) DESC,
        (pr.results_published_at IS NOT NULL) DESC,
        pr.close_at DESC NULLS LAST,
        pr.created_at DESC)
    FROM public.exam_papers pr
    LEFT JOIN public.exam_attempts oa
      ON oa.paper_id = pr.id AND oa.user_id = actor_id AND oa.attempt_kind = 'official' AND NOT oa.is_test
    WHERE pr.status IN ('published', 'closed')
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_my_papers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_my_papers(uuid) TO authenticated, service_role;

-- 首頁卡片文字沒填會自動產生，存成空白不再擋（原本 0201 的防呆）
CREATE OR REPLACE FUNCTION public.exam_save_announcement(p_paper_id uuid, p_announcement jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  row_out  public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_papers WHERE id = p_paper_id) THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;

  UPDATE public.exam_papers SET
    announcement = jsonb_build_object(
      'headline', COALESCE(p_announcement ->> 'headline', ''),
      'body',     COALESCE(p_announcement ->> 'body', ''),
      'ctaLabel', COALESCE(p_announcement ->> 'ctaLabel', ''))
  WHERE id = p_paper_id AND status <> 'closed'
  RETURNING * INTO row_out;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_announcement_locked'; END IF;
  RETURN to_jsonb(row_out);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_save_announcement(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_save_announcement(uuid, jsonb, uuid) TO authenticated, service_role;

-- ── 3. ① ② 可以改題目；② 結構鎖定 ──
CREATE OR REPLACE FUNCTION public.exam_upsert_paper(p_payload jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_paper_id UUID := NULLIF(p_payload ->> 'id', '')::uuid;
  v_sections JSONB := p_payload -> 'sections';
  v_has_plan BOOLEAN := p_payload ? 'linked_plan_id';
  v_plan_id  UUID := NULLIF(p_payload ->> 'linked_plan_id', '')::uuid;
  pr         public.exam_papers%ROWTYPE;
  stage      TEXT;
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
    INSERT INTO public.exam_papers (title, description, open_at, close_at,
        duration_minutes, total_points, pledge, sections, section_targets, linked_plan_id, created_by)
    VALUES (
      COALESCE(NULLIF(p_payload ->> 'title', ''), '速讀測驗'),
      COALESCE(p_payload ->> 'description', ''),
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
    RETURN to_jsonb(row_out);
  END IF;

  SELECT * INTO pr FROM public.exam_papers WHERE id = v_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_found'; END IF;
  stage := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at);
  IF stage NOT IN ('preparing', 'scheduled') THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;
  -- 已排程：題型題數在排程時驗證過，開放前沒有地方再檢查，所以不能改
  IF stage = 'scheduled' AND v_sections IS NOT NULL AND v_sections IS DISTINCT FROM pr.sections THEN
    RAISE EXCEPTION 'exam_scheduled_structure_locked';
  END IF;

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
  WHERE id = v_paper_id
  RETURNING * INTO row_out;

  -- 已排程時改了時間：跟排程時同樣的檢查（截止要晚於開放，而且在未來）
  IF stage = 'scheduled' AND (row_out.open_at IS NULL OR row_out.close_at IS NULL
      OR row_out.close_at <= row_out.open_at OR row_out.close_at <= NOW()) THEN
    RAISE EXCEPTION 'exam_window_invalid';
  END IF;

  RETURN to_jsonb(row_out);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_upsert_paper(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_upsert_paper(jsonb, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_upsert_question(p_payload jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_q_id     UUID := NULLIF(p_payload ->> 'id', '')::uuid;
  v_paper_id UUID := (p_payload ->> 'paper_id')::uuid;
  v_section  TEXT := p_payload ->> 'section';
  pr         public.exam_papers%ROWTYPE;
  stage      TEXT;
  row_out    public.exam_questions%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT * INTO pr FROM public.exam_papers WHERE id = v_paper_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;
  stage := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at);
  IF stage NOT IN ('preparing', 'scheduled') THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;

  IF v_q_id IS NULL THEN
    IF stage = 'scheduled' THEN RAISE EXCEPTION 'exam_scheduled_structure_locked'; END IF;
    INSERT INTO public.exam_questions (paper_id, section, position, points, payload, answer_key)
    VALUES (
      v_paper_id,
      v_section,
      COALESCE((p_payload ->> 'position')::int,
               (SELECT COALESCE(MAX(eq.position), 0) + 1 FROM public.exam_questions eq
                WHERE eq.paper_id = v_paper_id AND eq.section = v_section)),
      COALESCE((p_payload ->> 'points')::numeric, 1),
      COALESCE(p_payload -> 'payload', '{}'::jsonb),
      p_payload -> 'answer_key')
    RETURNING * INTO row_out;
  ELSE
    IF stage = 'scheduled' AND v_section IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.exam_questions eq WHERE eq.id = v_q_id AND eq.section <> v_section
    ) THEN
      RAISE EXCEPTION 'exam_scheduled_structure_locked';
    END IF;
    UPDATE public.exam_questions eq SET
      section = COALESCE(p_payload ->> 'section', eq.section),
      position = COALESCE((p_payload ->> 'position')::int, eq.position),
      points = COALESCE((p_payload ->> 'points')::numeric, eq.points),
      payload = COALESCE(p_payload -> 'payload', eq.payload),
      answer_key = CASE WHEN p_payload ? 'answer_key' THEN p_payload -> 'answer_key' ELSE eq.answer_key END
    WHERE eq.id = v_q_id AND eq.paper_id = v_paper_id
    RETURNING * INTO row_out;
    IF NOT FOUND THEN RAISE EXCEPTION 'exam_question_not_found'; END IF;
  END IF;

  RETURN to_jsonb(row_out);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_upsert_question(jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_upsert_question(jsonb, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_delete_question(p_question_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  pr public.exam_papers%ROWTYPE;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN ('admin', 'pastor') THEN
    RAISE EXCEPTION 'exam_admin_required';
  END IF;
  SELECT pr2.* INTO pr FROM public.exam_papers pr2
  JOIN public.exam_questions q ON q.paper_id = pr2.id
  WHERE q.id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_question_not_deletable'; END IF;
  -- 已排程：刪題會讓題數跟排程時驗證的不一樣，要先取消排程
  IF public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) = 'scheduled' THEN
    RAISE EXCEPTION 'exam_scheduled_structure_locked';
  END IF;
  DELETE FROM public.exam_questions q
  USING public.exam_papers pr3
  WHERE q.id = p_question_id AND q.paper_id = pr3.id AND pr3.status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'exam_question_not_deletable'; END IF;
  RETURN jsonb_build_object('deleted', p_question_id);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_delete_question(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_delete_question(uuid, uuid) TO authenticated, service_role;

-- ── 5. 試作：① ② 都算試作 ──
CREATE OR REPLACE FUNCTION public.exam_start_attempt(p_paper_id uuid, p_pledge_name text, p_reading_team_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
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
  now_ts TIMESTAMPTZ := NOW();
  seed TEXT;
  deadline TIMESTAMPTZ;
BEGIN
  -- 先清掉已開放卷上的試作，試作過的管理員開放後才能正式作答
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

  -- 管理員不受狀態與開放時段限制（準備中、已排程時是試作）。一般會友只能作答
  -- 已排程、在開放時段內的卷。
  IF NOT is_staff THEN
    IF pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN
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
    -- 試作：準備中或已排程（還沒開放作答）
    public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) IN ('preparing', 'scheduled'),
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
  want_preview BOOLEAN;
BEGIN
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
  ELSIF at.id IS NOT NULL THEN
    open_state := CASE WHEN at.status = 'in_progress' THEN 'open' ELSE pr.status END;
  ELSIF pr.status = 'draft' OR (pr.status = 'published' AND now_ts < pr.open_at) THEN
    open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;   -- 管理員試作（準備中、已排程）
  ELSIF pr.status <> 'published' THEN
    open_state := CASE WHEN is_staff THEN 'preview' ELSE 'not_open' END;
  ELSIF now_ts >= pr.close_at THEN
    open_state := 'closed';
  ELSE
    open_state := 'open';
  END IF;

  RETURN jsonb_build_object('state', open_state, 'preview', want_preview, 'attemptKind', p_attempt_kind,
    'paper', jsonb_build_object('id', pr.id, 'title', pr.title, 'status', pr.status,
      'stage', public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at),
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

-- 清除試作：① ② 都可以；只清試作（is_test），不碰正式作答
CREATE OR REPLACE FUNCTION public.exam_reset_attempts(p_paper_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  IF public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) NOT IN ('preparing', 'scheduled') THEN
    RAISE EXCEPTION 'exam_reset_live_forbidden';
  END IF;

  DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  RETURN jsonb_build_object('paperId', pr.id, 'deletedAttempts', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_reset_attempts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_reset_attempts(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exam_reset_my_rehearsal(p_paper_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
  IF public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) NOT IN ('preparing', 'scheduled') THEN
    RAISE EXCEPTION 'exam_rehearsal_draft_only';
  END IF;

  DELETE FROM public.exam_attempts
  WHERE paper_id = pr.id AND user_id = actor_id AND is_test;
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  RETURN jsonb_build_object('paperId', pr.id, 'deletedAttempts', n_deleted);
END;
$$;
REVOKE ALL ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) TO authenticated, service_role;

-- ── 6. 後台拿到伺服器算好的階段 ──
CREATE OR REPLACE FUNCTION public.exam_get_paper_admin(p_paper_id uuid DEFAULT NULL::uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE actor_id UUID:=public.resolve_quiz_actor(p_actor_id);target UUID:=p_paper_id;papers JSONB;result JSONB;
BEGIN
  IF public._exam_actor_role(actor_id) NOT IN('admin','pastor') THEN RAISE EXCEPTION 'exam_admin_required'; END IF;
  PERFORM public._exam_close_expired_papers();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',pr.id,'title',pr.title,'status',pr.status,
    'stage',public._exam_paper_stage(pr.status,pr.open_at,pr.results_published_at),
    'createdAt',pr.created_at,
    'questionCount',(SELECT COUNT(*) FROM public.exam_questions q WHERE q.paper_id=pr.id),
    'attemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id),
    'officialAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='official'),
    'practiceAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='practice'))
    ORDER BY pr.created_at DESC),'[]'::jsonb) INTO papers FROM public.exam_papers pr;
  IF target IS NULL THEN SELECT id INTO target FROM public.exam_papers ORDER BY created_at DESC LIMIT 1; END IF;
  IF target IS NULL THEN RETURN jsonb_build_object('papers',papers,'paper',NULL,'questions','[]'::jsonb,'attemptCount',0,'serverNow',NOW()); END IF;
  SELECT jsonb_build_object('papers',papers,
    'paper',to_jsonb(pr)||jsonb_build_object('stage',public._exam_paper_stage(pr.status,pr.open_at,pr.results_published_at)),
    'serverNow',NOW(),
    'attemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id),
    'testAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.is_test),
    'officialAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='official'),
    'practiceAttemptCount',(SELECT COUNT(*) FROM public.exam_attempts a WHERE a.paper_id=pr.id AND a.attempt_kind='practice'),
    'questions',COALESCE((SELECT jsonb_agg(to_jsonb(q)ORDER BY q.section,q.position)
      FROM public.exam_questions q WHERE q.paper_id=pr.id),'[]'::jsonb)) INTO result
  FROM public.exam_papers pr WHERE pr.id=target;
  RETURN COALESCE(result,jsonb_build_object('papers',papers,'paper',NULL,'questions','[]'::jsonb,'attemptCount',0,'serverNow',NOW()));
END;
$$;
REVOKE ALL ON FUNCTION public.exam_get_paper_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exam_get_paper_admin(uuid, uuid) TO authenticated, service_role;

-- 保險：這支 migration 動過的函式都不能讓 anon 執行（0214 的規則）
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%exam%'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can execute: %', bad; END IF;
END $$;
