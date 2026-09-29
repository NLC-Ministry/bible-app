-- ============================================================================
-- 20260929084154_exam_rehearsal_ignores_window.sql  —  #339
--
-- 問題：管理員按「試作」一進去就是「作答完成」，按「重新試作」也一樣。
--   exam_start_attempt（20260928031148，#298）的截止時間是
--   LEAST(開始＋作答時限, 試卷結束時間 close_at)，試作也套用。準備中的卷如果還留著
--   過期的 open_at/close_at（例如「隨堂測驗（測試）」留著 9/22），每次開始試作
--   截止時間一算出來就已經過了 → 前端剩 0 秒、立刻自動收卷。結束時間還沒過但很近時，
--   試作也只能做到結束時間。
--
-- 修正：試作（準備中／已排程，is_test）的截止時間固定是「開始＋作答時限」，
--   不看 open_at/close_at。正式作答不變，仍然不超過 close_at。
--   開放時間改在「排程」視窗裡選（前端），exam_publish 的 exam_window_invalid 檢查維持。
--
-- 只改 exam_start_attempt 一支，簽名與權限不變；沒有新增 RPC，nlc-data 不用改、
-- 不用重部署 Edge Function，舊版前端照常可用，不需要 forceUpdateBuiltBefore。
-- ============================================================================

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
  is_rehearsal BOOLEAN;
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

  -- 試作：準備中或已排程（還沒開放作答）
  is_rehearsal := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) IN ('preparing', 'scheduled');
  IF is_rehearsal THEN
    -- 試作不受開放時間影響（#339）：準備中的卷可能還留著過期的時間，或根本還沒設
    deadline := now_ts + make_interval(mins => pr.duration_minutes);
  ELSE
    -- 正式作答：作答時限內，而且不超過試卷結束時間
    deadline := LEAST(now_ts + make_interval(mins => pr.duration_minutes),
                      COALESCE(pr.close_at, now_ts + make_interval(mins => pr.duration_minutes)));
  END IF;

  INSERT INTO public.exam_attempts(paper_id, user_id, reading_team_id, is_test, status, started_at, deadline_at,
    pledge_name, pledge_agreed_at, pledge_snapshot, layout, paper_snapshot, attempt_kind, attempt_no)
  VALUES (pr.id, actor_id, p_reading_team_id,
    is_rehearsal,
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

-- 保險：大測驗函式都不能讓 anon 執行（0214 的規則）
DO $$
DECLARE bad TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE '%exam%'
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'anon can execute: %', bad; END IF;
END $$;
