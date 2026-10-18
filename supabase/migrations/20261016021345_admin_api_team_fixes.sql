-- #571 後台隊伍修正動作（隊伍除錯第二階段）：移出成員、把人加進這隊、重算狀態。
--
-- 1. admin_api_team_remove_member：移出一位成員。隊長只能在「隊上只剩他自己」時移出，等於解散這隊
--    （刪除隊伍；例如系統自動開的個人隊）；隊上還有別人時擋下（team_captain_has_members），不做轉移隊長。
-- 2. admin_api_team_add_member：把人加進這隊（角色＝隊員）。擋下：
--    · 已在同計畫同組別的別隊 → 不 RAISE，回 { added: false, blocked: 'already_in_other_team', other_team }，
--      畫面寫出是哪一隊（維護者 2026-10-16：不提供「從那隊移過來」，先到那一隊移出）。
--    · 帳號停用（user_inactive）、沒報名這個計畫（user_not_enrolled，和計畫名單同一個報名判定：
--      非個人計畫的 reading_plans，global_plan_id 相同或 preset key 相同）、隊伍已滿（reading_team_full）、
--      已經在這隊（already_in_team）。
--    · 階段的加入條件（沒設牧區、大區不在開放範圍、階段還沒開放）：先用 campaign_stage_join_block_reason
--      （和帶隊同一個判定，規則只在 assert_campaign_stage_open）擋下回原因碼（22023），
--      不然成員表的 0056 觸發器會丟 P0001、變成 500。
-- 3. admin_api_team_recompute_status：依實際人數修正「招募中／已滿」（給舊資料用）。
--
-- 共同：
--   · 先在 SQL 依操作者重查是不是系統管理員（admin_api_assert_admin，不是就 42501）；只授權 service_role。
--   · 已結束的教會挑戰階段一律不能改（同 0163 觸發器的條件），先擋下回 team_stage_ended（22023），
--     不 SET LOCAL "reading_team.allow_ended_edit"；0163 的觸發器仍是最後一道。
--   · 移出、加人之後在同一個交易依實際人數更新狀態（同 isTeamFull：人數 ≥ 組別人數＝已滿）。
--   · 稽核（audit.record）和修改在同一個交易，changes 記前後差異，原因選填。
--   · 異動歷程靠 0149 的呼叫堆疊判斷是誰改的：函式名稱在 team-report.mjs 認得（後台加入／後台移出）。
-- 依賴：20261014041833_admin_api_team_debug.sql（admin_api_assert_admin 來自 20261013114704）、
--       20260928101011_carryover_next_plan_by_date.sql（campaign_stage_join_block_reason）、
--       0163_lock_team_edits_on_ended_stage.sql、20261010181946_admin_audit_events.sql（audit.record）。

-- ── 共用（內部，不授權給任何角色）───────────────────────────────────────────

-- 已結束的教會挑戰階段 → team_stage_ended（條件同 0163 的 _reading_team_block_ended_stage_edits）
CREATE OR REPLACE FUNCTION public._admin_api_team_assert_editable(p_global_plan_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.global_plans AS gp
    WHERE gp.id = p_global_plan_id
      AND gp.end_date IS NOT NULL
      AND gp.plan_kind IN ('church_campaign_stage', 'church_campaign_stage_cohort')
      AND gp.end_date < (now() AT TIME ZONE 'Asia/Taipei')::date
  ) THEN
    RAISE EXCEPTION 'team_stage_ended' USING ERRCODE = '22023';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._admin_api_team_assert_editable(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 依實際人數更新狀態，回更新後的狀態（呼叫端要先鎖住隊伍列）
CREATE OR REPLACE FUNCTION public._admin_api_team_sync_status(p_team_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_division integer;
  v_status text;
  v_count integer;
  v_expected text;
BEGIN
  SELECT team.division, team.status INTO v_division, v_status FROM public.reading_teams AS team WHERE team.id = p_team_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*)::integer INTO v_count FROM public.reading_team_members AS member WHERE member.team_id = p_team_id;
  v_expected := CASE WHEN v_count >= v_division THEN 'ready' ELSE 'forming' END;
  IF v_status IS DISTINCT FROM v_expected THEN
    UPDATE public.reading_teams SET status = v_expected WHERE id = p_team_id;
  END IF;
  RETURN v_expected;
END;
$function$;
REVOKE ALL ON FUNCTION public._admin_api_team_sync_status(uuid) FROM PUBLIC, anon, authenticated, service_role;


-- ── 1. 移出成員（隊長是唯一成員＝解散）───────────────────────────────────────
-- 找不到隊伍回 NULL（admin-api 回 404 team_not_found）
CREATE OR REPLACE FUNCTION public.admin_api_team_remove_member(
  p_actor_id uuid,
  p_actor_role text,
  p_team_id uuid,
  p_user_id uuid,
  p_reason text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_team record;
  v_member record;
  v_count integer;
  v_dissolve boolean;
  v_status text;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  SELECT team.id, team.global_plan_id, team.division, team.status, team.captain_id, team.name INTO v_team
  FROM public.reading_teams AS team WHERE team.id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM public._admin_api_team_assert_editable(v_team.global_plan_id);

  SELECT member.user_id, member.member_role, prof.name INTO v_member
  FROM public.reading_team_members AS member
  LEFT JOIN public.profiles AS prof ON prof.id = member.user_id
  WHERE member.team_id = v_team.id AND member.user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'team_member_not_found' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::integer INTO v_count FROM public.reading_team_members AS member WHERE member.team_id = v_team.id;
  v_dissolve := p_user_id = v_team.captain_id;
  IF v_dissolve AND v_count > 1 THEN
    RAISE EXCEPTION 'team_captain_has_members' USING ERRCODE = '22023';
  END IF;

  IF v_dissolve THEN
    DELETE FROM public.reading_teams WHERE id = v_team.id;
    v_status := NULL;
  ELSE
    DELETE FROM public.reading_team_members WHERE team_id = v_team.id AND user_id = p_user_id;
    v_status := public._admin_api_team_sync_status(v_team.id);
  END IF;

  PERFORM audit.record('admin-api', CASE WHEN v_dissolve THEN 'team.dissolve' ELSE 'team.remove_member' END, 'ok',
    p_actor_id, p_actor_role, 'reading_teams', p_user_id, v_team.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'members', jsonb_build_object('before', v_count, 'after', v_count - 1),
      'status', CASE WHEN v_status IS DISTINCT FROM v_team.status
        THEN jsonb_build_object('before', v_team.status, 'after', COALESCE(v_status, 'deleted')) END
    )),
    p_reason, p_request_id,
    jsonb_build_object('global_plan_id', v_team.global_plan_id, 'team_name', v_team.name, 'division', v_team.division,
      'user_name', v_member.name, 'member_role', v_member.member_role, 'dissolved', v_dissolve));

  RETURN jsonb_build_object(
    'team_id', v_team.id,
    'global_plan_id', v_team.global_plan_id,
    'removed_user_id', p_user_id,
    'dissolved', v_dissolve,
    'member_count', v_count - 1,
    'status', v_status
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_remove_member(uuid, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_remove_member(uuid, text, uuid, uuid, text, text) TO service_role;


-- ── 2. 把人加進這隊 ────────────────────────────────────────────────────────
-- p_preset_key：admin-api 從計畫推出（同 team_detail），報名判定和計畫名單一樣。
CREATE OR REPLACE FUNCTION public.admin_api_team_add_member(
  p_actor_id uuid,
  p_actor_role text,
  p_team_id uuid,
  p_user_id uuid,
  p_preset_key text,
  p_reason text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_team record;
  v_user record;
  v_other record;
  v_count integer;
  v_status text;
  v_block text;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  SELECT team.id, team.global_plan_id, team.division, team.status, team.name INTO v_team
  FROM public.reading_teams AS team WHERE team.id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM public._admin_api_team_assert_editable(v_team.global_plan_id);

  SELECT prof.id, prof.name, prof.is_active INTO v_user FROM public.profiles AS prof WHERE prof.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_user.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'user_inactive' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.reading_team_members AS member WHERE member.team_id = v_team.id AND member.user_id = p_user_id) THEN
    RAISE EXCEPTION 'already_in_team' USING ERRCODE = '22023';
  END IF;

  SELECT other.id, other.name INTO v_other
  FROM public.reading_team_members AS member
  JOIN public.reading_teams AS other ON other.id = member.team_id
  WHERE member.global_plan_id = v_team.global_plan_id
    AND member.user_id = p_user_id
    AND member.division = v_team.division
    AND member.team_id <> v_team.id
  ORDER BY other.created_at, other.id
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('added', false, 'blocked', 'already_in_other_team',
      'other_team', jsonb_build_object('id', v_other.id, 'name', v_other.name));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.reading_plans AS plan
    WHERE plan.user_id = p_user_id
      AND NOT plan.is_personal
      AND (
        plan.global_plan_id = v_team.global_plan_id
        OR (NULLIF(p_preset_key, '') IS NOT NULL AND plan.preset_key = p_preset_key)
      )
  ) THEN
    RAISE EXCEPTION 'user_not_enrolled' USING ERRCODE = '22023';
  END IF;

  v_block := public.campaign_stage_join_block_reason(v_team.global_plan_id, p_user_id);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION '%', v_block USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::integer INTO v_count FROM public.reading_team_members AS member WHERE member.team_id = v_team.id;
  IF v_count >= v_team.division THEN
    RAISE EXCEPTION 'reading_team_full' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.reading_team_members(team_id, global_plan_id, user_id, division, member_role)
    VALUES (v_team.id, v_team.global_plan_id, p_user_id, v_team.division, 'member');
  EXCEPTION WHEN unique_violation THEN
    -- 競態：檢查後、寫入前又被別的路徑加進同計畫同組別的某隊
    RAISE EXCEPTION 'already_in_plan_division' USING ERRCODE = '22023';
  END;
  v_status := public._admin_api_team_sync_status(v_team.id);

  PERFORM audit.record('admin-api', 'team.add_member', 'ok',
    p_actor_id, p_actor_role, 'reading_teams', p_user_id, v_team.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'members', jsonb_build_object('before', v_count, 'after', v_count + 1),
      'status', CASE WHEN v_status IS DISTINCT FROM v_team.status
        THEN jsonb_build_object('before', v_team.status, 'after', v_status) END
    )),
    p_reason, p_request_id,
    jsonb_build_object('global_plan_id', v_team.global_plan_id, 'team_name', v_team.name, 'division', v_team.division,
      'user_name', v_user.name));

  RETURN jsonb_build_object(
    'added', true,
    'team_id', v_team.id,
    'user_id', p_user_id,
    'member_count', v_count + 1,
    'status', v_status
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_add_member(uuid, text, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_add_member(uuid, text, uuid, uuid, text, text, text) TO service_role;


-- ── 3. 重算狀態 ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_api_team_recompute_status(
  p_actor_id uuid,
  p_actor_role text,
  p_team_id uuid,
  p_reason text,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_team record;
  v_count integer;
  v_status text;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);
  SELECT team.id, team.global_plan_id, team.division, team.status, team.name INTO v_team
  FROM public.reading_teams AS team WHERE team.id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM public._admin_api_team_assert_editable(v_team.global_plan_id);

  SELECT COUNT(*)::integer INTO v_count FROM public.reading_team_members AS member WHERE member.team_id = v_team.id;
  v_status := public._admin_api_team_sync_status(v_team.id);

  PERFORM audit.record('admin-api', 'team.recompute_status', 'ok',
    p_actor_id, p_actor_role, 'reading_teams', NULL, v_team.id::text,
    CASE WHEN v_status IS DISTINCT FROM v_team.status
      THEN jsonb_build_object('status', jsonb_build_object('before', v_team.status, 'after', v_status))
      ELSE '{}'::jsonb END,
    p_reason, p_request_id,
    jsonb_build_object('global_plan_id', v_team.global_plan_id, 'team_name', v_team.name, 'division', v_team.division,
      'members', v_count, 'changed', v_status IS DISTINCT FROM v_team.status));

  RETURN jsonb_build_object(
    'team_id', v_team.id,
    'member_count', v_count,
    'status_before', v_team.status,
    'status', v_status,
    'changed', v_status IS DISTINCT FROM v_team.status
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_api_team_recompute_status(uuid, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_team_recompute_status(uuid, text, uuid, text, text) TO service_role;
