-- #567 後台「人」區：名單與查詢合一、個人頁「需要時才調閱」＋除錯檢查。
--
-- 1. admin_api_user_summary（同簽名改寫）：打開某人只拿事實——帳號、登入方式、組織、會員中心同步、各區筆數、
--    除錯檢查要的事實、各計畫給「會友 App 現在應該顯示」的每人事實（plan_progress_people 只查這一個人）。
--    不再帶各區最新 5 筆：內容改由 user_section 點開才調閱。檢查與「App 應該顯示」的判斷在 admin-api
--    （supabase/functions/admin-api/people.ts，執行和會友 App 同一份 _shared/progress 規則），不在 SQL。
--    同一個交易記 view_user（不變）。
-- 2. _admin_api_section_items：多三區——plans（所有計畫報名，含個人計畫）、teams（所屬隊伍）、
--    notifications（關心提醒、小測驗、大測驗通知）。經文筆記不給內容（屬於個人靈修），只在摘要給筆數與最後更新時間。
-- 3. admin_api_user_section／admin_api_user_timeline：改成帶操作者與查看理由；第一頁（沒有游標）在同一個交易
--    記一筆 view_user_section（區塊名稱放 detail.section），「載入更多」不再記。舊簽名刪掉。
-- 4. admin_api_directory_rows：搜尋字也比對登入身分的 email（原本「查詢使用者」找得到的人，名單也找得到）。
-- 5. admin_api_directory_list：OFFSET 分頁改成「排序鍵＋id」游標，資料變動中翻頁不會跳過或重複。舊簽名刪掉。
--
-- 全部只給 service_role；誰能呼叫由 admin-api 的能力表決定。
-- 依賴：20261011110008_admin_api_support.sql、20261012053123_admin_api_accounts.sql、
--       20261013114704_admin_api_plan_progress.sql（plan_progress_people）、20261010181946_admin_audit_events.sql。

-- ── 1. 各區塊（內部）────────────────────────────────────────────────────────
-- 同 20261011110008 的版本，多 plans、teams、notifications 三區；reading_logs 多回寫入時間（離線補送會晚於閱讀時間）。
CREATE OR REPLACE FUNCTION public._admin_api_section_items(
  p_user_id UUID,
  p_section TEXT,
  p_cursor_at TIMESTAMPTZ,
  p_cursor_id TEXT,
  p_limit INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_section_items$
DECLARE
  v_items JSONB;
BEGIN
  IF p_section = 'reading_logs' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT log.read_at AS at, log.id::text AS id,
        jsonb_build_object(
          'section', 'reading_logs', 'id', log.id::text, 'at', log.read_at,
          'plan_id', log.plan_id, 'plan_name', COALESCE(global_plan.name, plan.name),
          'book', log.book, 'chapter', log.chapter, 'round', log.round,
          'created_at', log.created_at, 'updated_at', log.updated_at
        ) AS item
      FROM public.reading_logs AS log
      LEFT JOIN public.reading_plans AS plan ON plan.id = log.plan_id
      LEFT JOIN public.global_plans AS global_plan ON global_plan.id = plan.global_plan_id
      WHERE log.user_id = p_user_id
        AND (p_cursor_at IS NULL OR log.read_at < p_cursor_at OR (log.read_at = p_cursor_at AND log.id::text < p_cursor_id))
      ORDER BY log.read_at DESC, log.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'team_events' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT event.created_at AS at, event.id::text AS id,
        jsonb_build_object(
          'section', 'team_events', 'id', event.id::text, 'at', event.created_at,
          'event_type', event.event_type, 'team_id', event.team_id, 'team_name', team.name,
          'global_plan_id', event.global_plan_id, 'plan_name', global_plan.name,
          'division', event.division, 'member_role', event.member_role, 'call_context', event.call_context
        ) AS item
      FROM public.reading_team_member_events AS event
      LEFT JOIN public.reading_teams AS team ON team.id = event.team_id
      LEFT JOIN public.global_plans AS global_plan ON global_plan.id = event.global_plan_id
      WHERE event.user_id = p_user_id
        AND (p_cursor_at IS NULL OR event.created_at < p_cursor_at OR (event.created_at = p_cursor_at AND event.id::text < p_cursor_id))
      ORDER BY event.created_at DESC, event.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'tests' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT * FROM (
        SELECT COALESCE(attempt.submitted_at, attempt.started_at, attempt.created_at) AS at, attempt.id::text AS id,
          jsonb_build_object(
            'section', 'tests', 'kind', 'exam', 'id', attempt.id::text,
            'at', COALESCE(attempt.submitted_at, attempt.started_at, attempt.created_at),
            'paper_id', attempt.paper_id, 'title', paper.title, 'attempt_kind', attempt.attempt_kind,
            'status', attempt.status, 'is_test', attempt.is_test, 'total_score', attempt.total_score,
            'started_at', attempt.started_at, 'submitted_at', attempt.submitted_at, 'submit_reason', attempt.submit_reason
          ) AS item
        FROM public.exam_attempts AS attempt
        LEFT JOIN public.exam_papers AS paper ON paper.id = attempt.paper_id
        WHERE attempt.user_id = p_user_id
        UNION ALL
        SELECT COALESCE(attempt.completed_at, attempt.started_at), attempt.id::text,
          jsonb_build_object(
            'section', 'tests', 'kind', 'daily_quiz', 'id', attempt.id::text,
            'at', COALESCE(attempt.completed_at, attempt.started_at),
            'publication_id', attempt.publication_id, 'quiz_date', publication.quiz_date,
            'status', attempt.status, 'score', attempt.score, 'total', attempt.total,
            'started_at', attempt.started_at, 'completed_at', attempt.completed_at
          )
        FROM public.quiz_attempts AS attempt
        LEFT JOIN public.quiz_publications AS publication ON publication.id = attempt.publication_id
        WHERE attempt.user_id = p_user_id
        UNION ALL
        SELECT COALESCE(attempt.completed_at, attempt.started_at), attempt.id::text,
          jsonb_build_object(
            'section', 'tests', 'kind', 'lightning_quiz', 'id', attempt.id::text,
            'at', COALESCE(attempt.completed_at, attempt.started_at),
            'question_id', attempt.question_id, 'rise_date', question.rise_date,
            'is_correct', attempt.is_correct, 'elapsed_ms', attempt.elapsed_ms,
            'started_at', attempt.started_at, 'completed_at', attempt.completed_at
          )
        FROM public.lightning_quiz_attempts AS attempt
        LEFT JOIN public.lightning_quiz_questions AS question ON question.id = attempt.question_id
        WHERE attempt.user_id = p_user_id
      ) AS tests
      WHERE p_cursor_at IS NULL OR tests.at < p_cursor_at OR (tests.at = p_cursor_at AND tests.id < p_cursor_id)
      ORDER BY tests.at DESC, tests.id DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'vouchers' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT voucher.issued_at AS at, voucher.id::text AS id,
        jsonb_build_object(
          'section', 'vouchers', 'id', voucher.id::text, 'at', voucher.issued_at,
          'week_start', voucher.week_start, 'rise_date', voucher.rise_date, 'rank', voucher.rank,
          'amount', voucher.amount, 'code', voucher.code, 'expires_on', voucher.expires_on,
          'redeemed_at', voucher.redeemed_at, 'redeemed_via', voucher.redeemed_via, 'voided_at', voucher.voided_at
        ) AS item
      FROM public.lightning_quiz_vouchers AS voucher
      WHERE voucher.user_id = p_user_id
        AND (p_cursor_at IS NULL OR voucher.issued_at < p_cursor_at OR (voucher.issued_at = p_cursor_at AND voucher.id::text < p_cursor_id))
      ORDER BY voucher.issued_at DESC, voucher.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'reports' THEN
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT report.created_at AS at, report.id::text AS id,
        jsonb_build_object(
          'section', 'reports', 'id', report.id::text, 'at', report.created_at,
          'category', report.category, 'status', report.status, 'description', left(report.description, 200),
          'last_message_at', report.last_message_at, 'closed_at', report.closed_at
        ) AS item
      FROM public.issue_reports AS report
      WHERE report.user_id = p_user_id
        AND (p_cursor_at IS NULL OR report.created_at < p_cursor_at OR (report.created_at = p_cursor_at AND report.id::text < p_cursor_id))
      ORDER BY report.created_at DESC, report.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'plans' THEN
    -- 所有報名（含個人計畫）：時間＝報名時間
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT plan.created_at AS at, plan.id::text AS id,
        jsonb_build_object(
          'section', 'plans', 'id', plan.id::text, 'at', plan.created_at,
          'plan_id', plan.id,
          'global_plan_id', public.admin_api_enrollment_plan_id(plan.global_plan_id, plan.preset_key),
          'name', COALESCE(global_plan.name, plan.name),
          'plan_kind', global_plan.plan_kind,
          'is_personal', plan.is_personal,
          'start_date', plan.start_date,
          'end_date', plan.end_date,
          'church_start_date', global_plan.start_date,
          'church_end_date', global_plan.end_date,
          'current_round', plan.current_round,
          'grace_days', global_plan.grace_days,
          'logged_chapters', stats.logged_chapters,
          'last_read_at', stats.last_read_at,
          'teams', COALESCE(teams.items, '[]'::jsonb)
        ) AS item
      FROM public.reading_plans AS plan
      LEFT JOIN public.global_plans AS global_plan
        ON global_plan.id = public.admin_api_enrollment_plan_id(plan.global_plan_id, plan.preset_key)
      LEFT JOIN LATERAL (
        SELECT count(*) AS logged_chapters, max(log.read_at) AS last_read_at
        FROM public.reading_logs AS log
        WHERE log.user_id = p_user_id AND log.plan_id = plan.id
      ) AS stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'team_id', team.id, 'name', team.name, 'division', team.division, 'is_captain', member.member_role = 'captain'
        ) ORDER BY team.division, team.id) AS items
        FROM public.reading_team_members AS member
        JOIN public.reading_teams AS team ON team.id = member.team_id
        WHERE member.user_id = p_user_id AND global_plan.id IS NOT NULL AND team.global_plan_id = global_plan.id
      ) AS teams ON TRUE
      WHERE plan.user_id = p_user_id
        AND (p_cursor_at IS NULL OR plan.created_at < p_cursor_at OR (plan.created_at = p_cursor_at AND plan.id::text < p_cursor_id))
      ORDER BY plan.created_at DESC, plan.id::text DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'teams' THEN
    -- 所屬隊伍（一隊一筆）：時間＝加入時間；隊伍頁連結用 team_id
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT * FROM (
        SELECT COALESCE(member.joined_at, team.created_at, 'epoch'::timestamptz) AS at, team.id::text AS id,
          jsonb_build_object(
            'section', 'teams', 'id', team.id::text, 'at', COALESCE(member.joined_at, team.created_at, 'epoch'::timestamptz),
            'team_id', team.id, 'team_name', team.name, 'global_plan_id', team.global_plan_id, 'plan_name', global_plan.name,
            'division', team.division, 'status', team.status, 'member_role', member.member_role,
            'size', (SELECT count(*) FROM public.reading_team_members AS other WHERE other.team_id = team.id)
          ) AS item
        FROM public.reading_team_members AS member
        JOIN public.reading_teams AS team ON team.id = member.team_id
        LEFT JOIN public.global_plans AS global_plan ON global_plan.id = team.global_plan_id
        WHERE member.user_id = p_user_id
      ) AS teams
      WHERE p_cursor_at IS NULL OR teams.at < p_cursor_at OR (teams.at = p_cursor_at AND teams.id < p_cursor_id)
      ORDER BY teams.at DESC, teams.id DESC
      LIMIT p_limit
    ) AS ranked;
  ELSIF p_section = 'notifications' THEN
    -- 收到的通知：關心提醒、小測驗發布、大測驗成績
    SELECT jsonb_agg(item ORDER BY at DESC, id DESC) INTO v_items FROM (
      SELECT * FROM (
        SELECT reminder.created_at AS at, reminder.id::text AS id,
          jsonb_build_object(
            'section', 'notifications', 'kind', 'care', 'id', reminder.id::text, 'at', reminder.created_at,
            'sender_name', sender.name, 'reason', reminder.reason, 'message', left(reminder.message, 200),
            'status', reminder.status, 'read_at', reminder.read_at, 'plan_name', global_plan.name
          ) AS item
        FROM public.care_reminders AS reminder
        LEFT JOIN public.profiles AS sender ON sender.id = reminder.sender_id
        LEFT JOIN public.global_plans AS global_plan ON global_plan.id = reminder.global_plan_id
        WHERE reminder.recipient_id = p_user_id
        UNION ALL
        SELECT notice.created_at, notice.id::text,
          jsonb_build_object(
            'section', 'notifications', 'kind', 'quiz', 'id', notice.id::text, 'at', notice.created_at,
            'message', left(notice.message, 200), 'status', notice.status, 'read_at', notice.read_at,
            'quiz_date', publication.quiz_date
          )
        FROM public.quiz_notifications AS notice
        LEFT JOIN public.quiz_publications AS publication ON publication.id = notice.publication_id
        WHERE notice.recipient_id = p_user_id
        UNION ALL
        SELECT notice.created_at, notice.id::text,
          jsonb_build_object(
            'section', 'notifications', 'kind', 'exam', 'id', notice.id::text, 'at', notice.created_at,
            'message', left(notice.message, 200), 'status', notice.status, 'read_at', notice.read_at
          )
        FROM public.exam_notifications AS notice
        WHERE notice.recipient_id = p_user_id
      ) AS notices
      WHERE p_cursor_at IS NULL OR notices.at < p_cursor_at OR (notices.at = p_cursor_at AND notices.id < p_cursor_id)
      ORDER BY notices.at DESC, notices.id DESC
      LIMIT p_limit
    ) AS ranked;
  ELSE
    RAISE EXCEPTION 'unknown_section' USING ERRCODE = '22023';
  END IF;
  RETURN COALESCE(v_items, '[]'::jsonb);
END;
$admin_api_section_items$;
REVOKE ALL ON FUNCTION public._admin_api_section_items(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_api_section_items(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER) TO service_role;

-- ── 2. user_section：點開某區才調閱（第一頁記 view_user_section）────────────────
DROP FUNCTION IF EXISTS public.admin_api_user_section(UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_api_user_section(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_user_id UUID,
  p_section TEXT,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_section$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
  v_items JSONB;
  v_last JSONB;
BEGIN
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
  END IF;
  v_items := public._admin_api_section_items(p_user_id, p_section, p_cursor_at, p_cursor_id, v_limit + 1);
  IF p_cursor_at IS NULL THEN
    PERFORM audit.record('admin-api', 'view_user_section', 'ok', p_actor_id, p_actor_role, 'profiles',
      p_user_id, p_user_id::text, NULL, p_reason, p_request_id, jsonb_build_object('section', p_section));
  END IF;
  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_last := v_items -> (v_limit - 1);
    RETURN jsonb_build_object('items', v_items, 'next_cursor', jsonb_build_object('at', v_last -> 'at', 'id', v_last -> 'id'));
  END IF;
  RETURN jsonb_build_object('items', v_items, 'next_cursor', NULL);
END;
$admin_api_user_section$;
REVOKE ALL ON FUNCTION public.admin_api_user_section(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_section(UUID, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- ── 3. user_timeline：各區合成時間軸（第一頁記 view_user_section，區塊＝timeline）──
DROP FUNCTION IF EXISTS public.admin_api_user_timeline(UUID, TIMESTAMPTZ, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_api_user_timeline(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_user_id UUID,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 30,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_timeline$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 50);
  v_items JSONB;
  v_last JSONB;
BEGIN
  IF (p_cursor_at IS NULL) <> (p_cursor_id IS NULL) THEN
    RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(merged.item ORDER BY merged.at DESC, merged.id DESC), '[]'::jsonb) INTO v_items
  FROM (
    SELECT part.item, (part.item ->> 'at')::timestamptz AS at, part.item ->> 'id' AS id
    FROM unnest(ARRAY['plans', 'reading_logs', 'teams', 'team_events', 'tests', 'vouchers', 'reports', 'notifications']) AS section(name)
    CROSS JOIN LATERAL jsonb_array_elements(
      public._admin_api_section_items(p_user_id, section.name, p_cursor_at, p_cursor_id, v_limit + 1)
    ) AS part(item)
    ORDER BY at DESC, id DESC
    LIMIT v_limit + 1
  ) AS merged;
  IF p_cursor_at IS NULL THEN
    PERFORM audit.record('admin-api', 'view_user_section', 'ok', p_actor_id, p_actor_role, 'profiles',
      p_user_id, p_user_id::text, NULL, p_reason, p_request_id, jsonb_build_object('section', 'timeline'));
  END IF;
  IF jsonb_array_length(v_items) > v_limit THEN
    v_items := v_items - v_limit;
    v_last := v_items -> (v_limit - 1);
    RETURN jsonb_build_object('items', v_items, 'next_cursor', jsonb_build_object('at', v_last -> 'at', 'id', v_last -> 'id'));
  END IF;
  RETURN jsonb_build_object('items', v_items, 'next_cursor', NULL);
END;
$admin_api_user_timeline$;
REVOKE ALL ON FUNCTION public.admin_api_user_timeline(UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_timeline(UUID, TEXT, UUID, TIMESTAMPTZ, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- ── 4. user_summary：打開某人（一次往返）＋ view_user 稽核 ───────────────────────
-- 找不到人回 NULL，並記一筆 error。facts／app_plans 的意義見 admin-api 的 people.ts。
CREATE OR REPLACE FUNCTION public.admin_api_user_summary(
  p_actor_id UUID,
  p_actor_role TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_user_summary$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_role public.role_definitions%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_emails TEXT[];
  v_result JSONB;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    PERFORM audit.record('admin-api', 'view_user', 'error', p_actor_id, p_actor_role, 'profiles',
      p_user_id, p_user_id::text, NULL, p_reason, p_request_id, jsonb_build_object('error', 'user_not_found'));
    RETURN NULL;
  END IF;
  SELECT * INTO v_role FROM public.role_definitions WHERE id = v_profile.role_id;

  -- 這個人用過的 email（帳號＋各登入身分），找「同一個 email 的其他帳號」用
  SELECT COALESCE(array_agg(DISTINCT lower(btrim(email))), ARRAY[]::TEXT[]) INTO v_emails
  FROM (
    SELECT v_profile.email AS email
    UNION ALL
    SELECT identity.email FROM public.user_identities AS identity WHERE identity.profile_id = p_user_id
  ) AS used
  WHERE NULLIF(btrim(email), '') IS NOT NULL;

  WITH enrollments AS (
    -- 教會計畫的報名（個人計畫不算）；舊列只有 preset_key 時推回計畫 id
    SELECT plan.id AS plan_id, plan.preset_key, plan.created_at, plan.target_books AS own_books,
      public.admin_api_enrollment_plan_id(plan.global_plan_id, plan.preset_key) AS global_plan_id
    FROM public.reading_plans AS plan
    WHERE plan.user_id = p_user_id AND NOT COALESCE(plan.is_personal, FALSE)
  ),
  church_enrollments AS (
    SELECT enrollments.*, global_plan.name AS plan_name, global_plan.start_date, global_plan.end_date,
      global_plan.is_fixed, global_plan.grace_days,
      COALESCE(NULLIF(enrollments.own_books, ARRAY[]::text[]), global_plan.target_books, ARRAY[]::text[]) AS books
    FROM enrollments
    JOIN public.global_plans AS global_plan ON global_plan.id = enrollments.global_plan_id
  )
  SELECT jsonb_build_object(
    'account', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'email_masked', public.admin_api_mask_email(v_profile.email),
      'phone_masked', public.admin_api_mask_phone(v_profile.phone),
      'has_email', v_profile.email IS NOT NULL AND btrim(v_profile.email) <> '',
      'has_phone', v_profile.phone IS NOT NULL AND btrim(v_profile.phone) <> '',
      'avatar_url', v_profile.avatar_url,
      'is_active', v_profile.is_active,
      'role_code', COALESCE(v_role.code, 'member'),
      'role_label', v_role.label,
      'created_at', v_profile.created_at,
      'last_seen_at', v_profile.last_seen_at,
      'has_member_hub_id', v_profile.nlc_member_id IS NOT NULL,
      'managed_regions', v_profile.managed_regions,
      'managed_zones', v_profile.managed_zones,
      'managed_groups', v_profile.managed_groups
    ),
    'identities', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'provider', identity.provider,
        'email_masked', public.admin_api_mask_email(identity.email),
        'is_primary', identity.is_primary,
        'created_at', identity.created_at,
        'last_seen_at', identity.last_seen_at
      ) ORDER BY identity.is_primary DESC, identity.created_at)
      FROM public.user_identities AS identity
      WHERE identity.profile_id = p_user_id
    ), '[]'::jsonb),
    'org', jsonb_build_object(
      'great_region', v_profile.great_region, 'great_region_id', v_profile.great_region_id,
      'pastoral_zone', v_profile.pastoral_zone, 'pastoral_zone_id', v_profile.pastoral_zone_id,
      'small_group', v_profile.small_group, 'small_group_id', v_profile.small_group_id
    ),
    'member_hub', jsonb_build_object(
      'synced_at', v_profile.member_context_synced_at,
      'sync_attempted_at', v_profile.member_context_sync_attempted_at,
      'sync_status', v_profile.member_context_sync_status,
      'sync_error', v_profile.member_context_sync_error,
      'contract_version', v_profile.member_context_contract_version,
      'membership_lifecycle_state', v_profile.member_context_membership_lifecycle_state,
      'placement_state', v_profile.member_context_placement_state,
      'placement_workflow_state', v_profile.member_context_placement_workflow_state,
      'has_required_placement', v_profile.member_context_has_required_placement,
      'required_action', v_profile.member_context_required_action,
      'leadership_display_label', v_profile.member_context_leadership_display_label
    ),
    'counts', jsonb_build_object(
      'plans', (SELECT count(*) FROM public.reading_plans WHERE user_id = p_user_id),
      'teams', (SELECT count(*) FROM public.reading_team_members WHERE user_id = p_user_id),
      'reading_logs', (SELECT count(*) FROM public.reading_logs WHERE user_id = p_user_id),
      'team_events', (SELECT count(*) FROM public.reading_team_member_events WHERE user_id = p_user_id),
      'tests', (SELECT count(*) FROM public.exam_attempts WHERE user_id = p_user_id)
             + (SELECT count(*) FROM public.quiz_attempts WHERE user_id = p_user_id)
             + (SELECT count(*) FROM public.lightning_quiz_attempts WHERE user_id = p_user_id),
      'vouchers', (SELECT count(*) FROM public.lightning_quiz_vouchers WHERE user_id = p_user_id),
      'reports', (SELECT count(*) FROM public.issue_reports WHERE user_id = p_user_id),
      'notifications', (SELECT count(*) FROM public.care_reminders WHERE recipient_id = p_user_id)
                     + (SELECT count(*) FROM public.quiz_notifications WHERE recipient_id = p_user_id)
                     + (SELECT count(*) FROM public.exam_notifications WHERE recipient_id = p_user_id)
    ),
    -- 兌換券依狀態（同 items.ts 的判斷順序：作廢 → 已兌換 → 過期 → 未兌換）
    'voucher_states', (
      SELECT jsonb_build_object(
        'unredeemed', count(*) FILTER (WHERE voided_at IS NULL AND redeemed_at IS NULL AND (expires_on IS NULL OR expires_on >= v_today)),
        'redeemed', count(*) FILTER (WHERE voided_at IS NULL AND redeemed_at IS NOT NULL),
        'expired', count(*) FILTER (WHERE voided_at IS NULL AND redeemed_at IS NULL AND expires_on < v_today),
        'voided', count(*) FILTER (WHERE voided_at IS NOT NULL)
      )
      FROM public.lightning_quiz_vouchers WHERE user_id = p_user_id
    ),
    -- 經文筆記屬於個人靈修：只給筆數與最後更新時間，不給內容
    'notes', jsonb_build_object(
      'verse_notes', (SELECT count(*) FROM public.verse_notes WHERE user_id = p_user_id),
      'devotional_notes', (SELECT count(*) FROM public.devotional_notes WHERE user_id = p_user_id),
      'last_updated_at', GREATEST(
        (SELECT max(updated_at) FROM public.verse_notes WHERE user_id = p_user_id),
        (SELECT max(updated_at) FROM public.devotional_notes WHERE user_id = p_user_id)
      )
    ),
    'facts', jsonb_build_object(
      'today', v_today,
      -- 同一個教會計畫有一筆以上報名
      'duplicate_enrollments', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('global_plan_id', dup.global_plan_id, 'plan_name', dup.plan_name, 'count', dup.n) ORDER BY dup.plan_name)
        FROM (
          SELECT global_plan_id, max(plan_name) AS plan_name, count(*) AS n
          FROM church_enrollments GROUP BY global_plan_id HAVING count(*) > 1
        ) AS dup
      ), '[]'::jsonb),
      -- 沒有歸屬計畫的打卡（plan_id 是 NULL）：部分畫面會把它們算進目前的計畫，章數會多算
      'orphan_logs', (
        SELECT jsonb_build_object(
          'count', count(*),
          'chapters', count(DISTINCT (log.book, log.chapter, log.round)),
          'books', COALESCE((SELECT jsonb_agg(DISTINCT orphan.book) FROM public.reading_logs AS orphan WHERE orphan.user_id = p_user_id AND orphan.plan_id IS NULL), '[]'::jsonb),
          'first_read_at', min(log.read_at),
          'last_read_at', max(log.read_at)
        )
        FROM public.reading_logs AS log
        WHERE log.user_id = p_user_id AND log.plan_id IS NULL
      ),
      -- 每個教會計畫：App「累積閱讀章數」（get_my_plan_chapter_total 的算法：這筆報名裡不重複的章）
      -- vs 計畫進度用的章數（plan_progress_people 的算法：只算計畫書卷）
      'chapter_totals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'plan_id', church.plan_id, 'global_plan_id', church.global_plan_id, 'plan_name', church.plan_name,
          'app_total', totals.app_total, 'in_books', totals.in_books
        ) ORDER BY church.start_date DESC NULLS LAST, church.plan_id)
        FROM church_enrollments AS church
        CROSS JOIN LATERAL (
          SELECT count(*) AS app_total,
                 count(*) FILTER (WHERE cardinality(church.books) = 0 OR distinct_logs.book = ANY (church.books)) AS in_books
          FROM (
            SELECT DISTINCT log.book, log.chapter, log.round
            FROM public.reading_logs AS log
            WHERE log.user_id = p_user_id AND log.plan_id = church.plan_id
          ) AS distinct_logs
        ) AS totals
      ), '[]'::jsonb),
      -- 登入身分：同一個會員中心 id、同一個 email 還有別的帳號
      'identities', jsonb_build_object(
        'count', (SELECT count(*) FROM public.user_identities WHERE profile_id = p_user_id),
        'shared_member_id', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', other.id, 'name', other.name) ORDER BY other.created_at)
          FROM (
            SELECT other.id, other.name, other.created_at FROM public.profiles AS other
            WHERE v_profile.nlc_member_id IS NOT NULL AND other.nlc_member_id = v_profile.nlc_member_id AND other.id <> p_user_id
            ORDER BY other.created_at LIMIT 5
          ) AS other
        ), '[]'::jsonb),
        'shared_email', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', other.id, 'name', other.name) ORDER BY other.created_at)
          FROM (
            SELECT other.id, other.name, other.created_at FROM public.profiles AS other
            WHERE other.id <> p_user_id AND cardinality(v_emails) > 0
              AND (lower(btrim(other.email)) = ANY (v_emails)
                OR EXISTS (SELECT 1 FROM public.user_identities AS identity
                           WHERE identity.profile_id = other.id AND lower(btrim(identity.email)) = ANY (v_emails)))
            ORDER BY other.created_at LIMIT 5
          ) AS other
        ), '[]'::jsonb)
      ),
      -- 同一個計畫、同一個組別在不只一隊
      'team_conflicts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'global_plan_id', conflict.global_plan_id, 'plan_name', conflict.plan_name, 'division', conflict.division, 'teams', conflict.teams
        ) ORDER BY conflict.plan_name, conflict.division)
        FROM (
          SELECT team.global_plan_id, max(global_plan.name) AS plan_name, team.division,
            jsonb_agg(jsonb_build_object('id', team.id, 'name', team.name) ORDER BY team.name, team.id) AS teams
          FROM public.reading_team_members AS member
          JOIN public.reading_teams AS team ON team.id = member.team_id
          LEFT JOIN public.global_plans AS global_plan ON global_plan.id = team.global_plan_id
          WHERE member.user_id = p_user_id
          GROUP BY team.global_plan_id, team.division
          HAVING count(*) > 1
        ) AS conflict
      ), '[]'::jsonb),
      -- 固定日期計畫：截止（end_date＋寬限天數，台北時間）之後還被寫入或修改的打卡筆數（#412 之後應該是 0）
      'grace', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'global_plan_id', church.global_plan_id, 'plan_name', church.plan_name,
          'end_date', church.end_date, 'grace_days', church.grace_days,
          'cutoff', church.end_date + church.grace_days,
          'late_writes', (
            SELECT count(*) FROM public.reading_logs AS log
            WHERE log.user_id = p_user_id AND log.plan_id = church.plan_id
              AND (GREATEST(log.created_at, log.updated_at) AT TIME ZONE 'Asia/Taipei')::date > church.end_date + church.grace_days
          )
        ) ORDER BY church.end_date DESC, church.plan_id)
        FROM church_enrollments AS church
        WHERE church.is_fixed IS TRUE AND church.end_date IS NOT NULL
      ), '[]'::jsonb),
      -- 最近一次回報附的 App 版本（#548 的診斷資訊）；伺服器沒有其他地方記會友的 App 版本
      'last_report_build', (
        SELECT jsonb_build_object('build_id', report.metadata -> 'diagnostics' ->> 'build_id', 'reported_at', report.created_at)
        FROM public.issue_reports AS report
        WHERE report.user_id = p_user_id AND jsonb_typeof(report.metadata -> 'diagnostics') = 'object'
        ORDER BY report.created_at DESC
        LIMIT 1
      )
    ),
    -- 「會友 App 現在應該顯示」：每個教會計畫（最近 6 個）各查一次只含這個人的 plan_progress_people；
    -- plan 的欄位同 admin_api_plan_info（admin-api 用它排出教會原始日程）
    'app_plans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'plan', jsonb_build_object(
          'id', global_plan.id, 'name', global_plan.name, 'plan_kind', global_plan.plan_kind,
          'start_date', global_plan.start_date, 'end_date', global_plan.end_date,
          'target_books', global_plan.target_books, 'rules', global_plan.rules, 'is_hidden', global_plan.is_hidden
        ),
        'people', public.plan_progress_people(global_plan.id, picked.preset_key, FALSE, ARRAY[p_user_id], p_actor_id)
      ) ORDER BY global_plan.start_date DESC NULLS LAST, global_plan.id)
      FROM (
        SELECT DISTINCT ON (church.global_plan_id) church.global_plan_id, church.preset_key
        FROM church_enrollments AS church
        ORDER BY church.global_plan_id, church.created_at DESC
      ) AS picked
      JOIN public.global_plans AS global_plan ON global_plan.id = picked.global_plan_id
      WHERE global_plan.id IN (
        SELECT recent.global_plan_id FROM church_enrollments AS recent
        GROUP BY recent.global_plan_id
        ORDER BY max(recent.start_date) DESC NULLS LAST, recent.global_plan_id
        LIMIT 6
      )
    ), '[]'::jsonb)
  ) INTO v_result;

  PERFORM audit.record('admin-api', 'view_user', 'ok', p_actor_id, p_actor_role, 'profiles',
    p_user_id, p_user_id::text, NULL, p_reason, p_request_id, NULL);
  RETURN v_result;
END;
$admin_api_user_summary$;
REVOKE ALL ON FUNCTION public.admin_api_user_summary(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_user_summary(UUID, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ── 5. 名單：搜尋字也比對登入身分的 email ─────────────────────────────────────
-- 同 20261012053123 的版本，只在搜尋字比對多一欄（各登入身分的 email）。
CREATE OR REPLACE FUNCTION public.admin_api_directory_rows(
  p_actor_id UUID,
  p_q TEXT DEFAULT NULL,
  p_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_plan_id UUID DEFAULT NULL,
  p_participation TEXT DEFAULT 'all',
  p_team TEXT DEFAULT 'all',
  p_incomplete BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  great_region TEXT,
  pastoral_zone TEXT,
  small_group TEXT,
  is_active BOOLEAN,
  sync_status TEXT,
  synced_at TIMESTAMPTZ,
  role_code TEXT,
  role_label TEXT,
  managed_regions TEXT,
  managed_zones TEXT,
  managed_groups TEXT,
  joined BOOLEAN,
  teams JSONB,
  sort_region INTEGER,
  sort_zone INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_rows$
  WITH enrolled AS (
    SELECT DISTINCT plan.user_id
    FROM public.reading_plans AS plan
    WHERE p_plan_id IS NOT NULL
      AND (plan.global_plan_id = p_plan_id
        OR (plan.global_plan_id IS NULL AND plan.preset_key IS NOT NULL
          AND public.admin_api_enrollment_plan_id(NULL, plan.preset_key) = p_plan_id))
  ),
  plan_teams AS (
    SELECT member.user_id,
      jsonb_agg(jsonb_build_object('name', team.name, 'role', member.member_role) ORDER BY member.team_id) AS teams,
      string_agg(COALESCE(team.name, ''), ' ') AS team_text
    FROM public.reading_team_members AS member
    LEFT JOIN public.reading_teams AS team ON team.id = member.team_id
    WHERE p_plan_id IS NOT NULL AND member.global_plan_id = p_plan_id
    GROUP BY member.user_id
  ),
  base AS (
    SELECT
      profile.id, profile.name, profile.email,
      NULLIF(btrim(profile.great_region), '') AS great_region,
      NULLIF(btrim(profile.pastoral_zone), '') AS pastoral_zone,
      NULLIF(btrim(profile.small_group), '') AS small_group,
      profile.is_active,
      profile.member_context_sync_status AS sync_status,
      profile.member_context_synced_at AS synced_at,
      COALESCE(role.code, 'member') AS role_code,
      role.label AS role_label,
      COALESCE(profile.managed_regions, '') AS managed_regions,
      COALESCE(profile.managed_zones, '') AS managed_zones,
      COALESCE(profile.managed_groups, '') AS managed_groups,
      (enrolled.user_id IS NOT NULL) AS joined,
      COALESCE(plan_teams.teams, '[]'::jsonb) AS teams,
      COALESCE(plan_teams.team_text, '') AS team_text,
      region.sort_order AS sort_region,
      -- 牧區名稱只在同一個大區內唯一：用子查詢取排序，不 JOIN，免得同名牧區把人重複列出
      (SELECT min(zone.sort_order) FROM public.pastoral_zones AS zone
        WHERE zone.name = NULLIF(btrim(profile.pastoral_zone), '')
          AND (region.id IS NULL OR zone.great_region_id = region.id)) AS sort_zone
    FROM public.profiles AS profile
    LEFT JOIN public.role_definitions AS role ON role.id = profile.role_id
    LEFT JOIN enrolled ON enrolled.user_id = profile.id
    LEFT JOIN plan_teams ON plan_teams.user_id = profile.id
    LEFT JOIN public.great_regions AS region ON region.name = NULLIF(btrim(profile.great_region), '')
  )
  SELECT
    base.id, base.name, base.email, base.great_region, base.pastoral_zone, base.small_group,
    base.is_active, base.sync_status, base.synced_at, base.role_code, base.role_label,
    base.managed_regions, base.managed_zones, base.managed_groups,
    base.joined, base.teams, base.sort_region, base.sort_zone
  FROM base
  WHERE (cardinality(COALESCE(p_regions, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.great_region, '__unassigned__') = ANY (p_regions))
    AND (cardinality(COALESCE(p_zones, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.pastoral_zone, '__unassigned__') = ANY (p_zones))
    AND (cardinality(COALESCE(p_groups, ARRAY[]::TEXT[])) = 0
      OR COALESCE(base.small_group, '__unassigned__') = ANY (p_groups))
    AND (NOT COALESCE(p_incomplete, FALSE)
      OR NULLIF(btrim(COALESCE(base.name, '')), '') IS NULL OR base.pastoral_zone IS NULL)
    AND (COALESCE(p_participation, 'all') = 'all'
      OR (p_participation = 'joined' AND base.joined)
      OR (p_participation = 'not_joined' AND NOT base.joined
        AND base.is_active IS TRUE AND base.id IS DISTINCT FROM p_actor_id))
    AND (COALESCE(p_team, 'all') = 'all'
      OR (p_team = 'joined' AND jsonb_array_length(base.teams) > 0)
      OR (p_team = 'not_joined' AND jsonb_array_length(base.teams) = 0))
    AND (NULLIF(btrim(COALESCE(p_q, '')), '') IS NULL
      OR lower(concat_ws(' ', base.name, base.email, COALESCE(base.role_label, CASE WHEN base.role_code = 'member' THEN '一般會友' ELSE base.role_code END),
          base.great_region, base.pastoral_zone, base.small_group, base.team_text,
          (SELECT string_agg(identity.email, ' ') FROM public.user_identities AS identity WHERE identity.profile_id = base.id)))
        LIKE '%' || replace(replace(replace(lower(btrim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%');
$admin_api_directory_rows$;
REVOKE ALL ON FUNCTION public.admin_api_directory_rows(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_rows(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN) TO service_role;

-- ── 6. 名單一頁：游標分頁 ─────────────────────────────────────────────────────
-- 排序同以前（大區、牧區的 sort_order，再名稱、姓名、id；空的排最後）。游標＝上一頁最後一人的
-- [大區排序, 大區, 牧區排序, 牧區, 姓名, id]（JSON 陣列，空的是 null），下一頁從「排在它後面」的人開始，
-- 中間有人新增、改名或刪除都不會跳過或重複已經列出的人。比較用 (是否為空, 值) 一組組比，等於 NULLS LAST。
-- 第一頁（沒有游標）附：計畫選項、沒指定計畫時的預設計畫、全部人數（同舊版）。
DROP FUNCTION IF EXISTS public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.admin_api_directory_list(
  p_actor_id UUID,
  p_q TEXT DEFAULT NULL,
  p_regions TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_zones TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_groups TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_plan_id UUID DEFAULT NULL,
  p_participation TEXT DEFAULT 'all',
  p_team TEXT DEFAULT 'all',
  p_incomplete BOOLEAN DEFAULT FALSE,
  p_cursor JSONB DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $admin_api_directory_list$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Taipei')::date;
  v_plan_id UUID := p_plan_id;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  v_first BOOLEAN := p_cursor IS NULL OR jsonb_typeof(p_cursor) = 'null';
  c_region INTEGER;
  c_region_name TEXT;
  c_zone INTEGER;
  c_zone_name TEXT;
  c_name TEXT;
  c_id UUID;
  v_items JSONB;
  v_total BIGINT;
  v_more BOOLEAN;
  v_plans JSONB;
BEGIN
  IF p_participation NOT IN ('all', 'joined', 'not_joined') OR p_team NOT IN ('all', 'joined', 'not_joined') THEN
    RAISE EXCEPTION 'invalid_plan_filter' USING ERRCODE = '22023';
  END IF;
  IF NOT v_first THEN
    IF jsonb_typeof(p_cursor) <> 'array' OR jsonb_array_length(p_cursor) <> 6 OR jsonb_typeof(p_cursor -> 5) <> 'string' THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END IF;
    BEGIN
      c_region := (p_cursor ->> 0)::integer;
      c_region_name := p_cursor ->> 1;
      c_zone := (p_cursor ->> 2)::integer;
      c_zone_name := p_cursor ->> 3;
      c_name := p_cursor ->> 4;
      c_id := (p_cursor ->> 5)::uuid;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = '22023';
    END;
  END IF;

  IF v_first THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', plan.id, 'name', plan.name, 'start_date', plan.start_date, 'end_date', plan.end_date, 'plan_kind', plan.plan_kind
      ) ORDER BY plan.start_date NULLS LAST, plan.name), '[]'::jsonb)
    INTO v_plans
    FROM public.global_plans AS plan
    WHERE NOT COALESCE(plan.is_hidden, FALSE) AND COALESCE(plan.plan_kind, 'standard') <> 'church_campaign';
  END IF;

  IF v_plan_id IS NULL THEN
    SELECT plan.id INTO v_plan_id
    FROM public.global_plans AS plan
    WHERE NOT COALESCE(plan.is_hidden, FALSE) AND COALESCE(plan.plan_kind, 'standard') <> 'church_campaign'
    ORDER BY
      CASE WHEN plan.start_date <= v_today AND (plan.end_date IS NULL OR v_today <= plan.end_date) THEN 0
           WHEN plan.start_date > v_today THEN 1
           ELSE 2 END,
      CASE WHEN plan.start_date <= v_today AND (plan.end_date IS NULL OR v_today <= plan.end_date) THEN plan.start_date END DESC NULLS LAST,
      CASE WHEN plan.start_date > v_today THEN plan.start_date END ASC NULLS LAST,
      plan.end_date DESC NULLS LAST,
      plan.id
    LIMIT 1;
  END IF;

  WITH filtered AS (
    SELECT dir.*
    FROM public.admin_api_directory_rows(p_actor_id, p_q, p_regions, p_zones, p_groups, v_plan_id,
      p_participation, p_team, p_incomplete) AS dir
  ),
  page AS (
    SELECT filtered.*
    FROM filtered
    WHERE v_first OR (
      filtered.sort_region IS NULL, COALESCE(filtered.sort_region, 0),
      filtered.great_region IS NULL, COALESCE(filtered.great_region, ''),
      filtered.sort_zone IS NULL, COALESCE(filtered.sort_zone, 0),
      filtered.pastoral_zone IS NULL, COALESCE(filtered.pastoral_zone, ''),
      filtered.name IS NULL, COALESCE(filtered.name, ''),
      filtered.id
    ) > (
      c_region IS NULL, COALESCE(c_region, 0),
      c_region_name IS NULL, COALESCE(c_region_name, ''),
      c_zone IS NULL, COALESCE(c_zone, 0),
      c_zone_name IS NULL, COALESCE(c_zone_name, ''),
      c_name IS NULL, COALESCE(c_name, ''),
      c_id
    )
    ORDER BY filtered.sort_region IS NULL, COALESCE(filtered.sort_region, 0),
      filtered.great_region IS NULL, COALESCE(filtered.great_region, ''),
      filtered.sort_zone IS NULL, COALESCE(filtered.sort_zone, 0),
      filtered.pastoral_zone IS NULL, COALESCE(filtered.pastoral_zone, ''),
      filtered.name IS NULL, COALESCE(filtered.name, ''),
      filtered.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT page.*, row_number() OVER (
      ORDER BY page.sort_region IS NULL, COALESCE(page.sort_region, 0),
        page.great_region IS NULL, COALESCE(page.great_region, ''),
        page.sort_zone IS NULL, COALESCE(page.sort_zone, 0),
        page.pastoral_zone IS NULL, COALESCE(page.pastoral_zone, ''),
        page.name IS NULL, COALESCE(page.name, ''),
        page.id
    ) AS seq
    FROM page
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', numbered.id, 'name', numbered.name, 'email_masked', public.admin_api_mask_email(numbered.email),
      'great_region', numbered.great_region, 'pastoral_zone', numbered.pastoral_zone, 'small_group', numbered.small_group,
      'is_active', numbered.is_active, 'sync_status', numbered.sync_status, 'synced_at', numbered.synced_at,
      'role_code', numbered.role_code, 'role_label', numbered.role_label,
      'managed_regions', numbered.managed_regions, 'managed_zones', numbered.managed_zones, 'managed_groups', numbered.managed_groups,
      'joined', numbered.joined, 'teams', numbered.teams,
      'sort_key', jsonb_build_array(numbered.sort_region, numbered.great_region, numbered.sort_zone, numbered.pastoral_zone, numbered.name, numbered.id)
    ) ORDER BY numbered.seq) FILTER (WHERE numbered.seq <= v_limit), '[]'::jsonb),
    COALESCE(bool_or(numbered.seq > v_limit), FALSE),
    (SELECT count(*) FROM filtered)
  INTO v_items, v_more, v_total
  FROM numbered;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'next_cursor', CASE WHEN v_more THEN v_items -> (jsonb_array_length(v_items) - 1) -> 'sort_key' END,
    'plan_id', v_plan_id,
    'plans', v_plans,
    'all_count', CASE WHEN v_first THEN (SELECT count(*) FROM public.profiles) END
  );
END;
$admin_api_directory_list$;
REVOKE ALL ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_directory_list(UUID, TEXT, TEXT[], TEXT[], TEXT[], UUID, TEXT, TEXT, BOOLEAN, JSONB, INTEGER) TO service_role;
