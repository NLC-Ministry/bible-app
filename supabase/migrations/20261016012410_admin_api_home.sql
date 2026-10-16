-- #569 後台首頁（今天要處理的事）：只有數字、不含任何人的名字、不記稽核。
--
-- admin_api_home_counts：首頁除了「計畫」那幾格以外的數字，一次算完。每一格的數法都和點進去那一頁相同：
--   · 回報：未結案＝待處理＋處理中、有新訊息＝會友留言比管理員上次讀的晚——和 admin_api_report_list 的 counts 同一個條件
--     （收件匣的「未結案」「有新訊息」）；另外給未結案裡最早送出的時間（首頁寫「最舊的等了幾天」）。
--   · 經文注釋：review_status = 'pending'（待審）、'approved'（審核通過、還沒發布）——內容 → 經文注釋的審核流程（#471）。
--   · 明天的小測驗：直接用小測驗日曆（get_daily_quiz_calendar）算明天那一格的狀態，不另寫一套；
--     功能開放設定（daily_quiz）、這個計畫有沒有設定小測驗也一起給，沒開或沒設定的首頁不顯示。
--   · 最近的設定變更：稽核紀錄裡成功的設定類動作，最近 30 天最多 5 筆，**只給動作與時間**（不給操作者與對象）。
-- 需要關心的人數、還沒滿的隊、本期進度由 admin-api 用和計畫總覽同一份規則算（admin_api_plan_people，#564），不在這裡。
--
-- 只有系統管理員（admin_api_assert_admin，不是就 42501）；只給 service_role。
-- 依賴：20261013114704_admin_api_plan_progress.sql（admin_api_assert_admin）、
--       20261008064652_daily_quiz_generation_progress.sql（get_daily_quiz_calendar 最新版）、
--       20261009092820_commentary_review.sql（review_status）、20261010181946_admin_audit_events.sql（audit.admin_events）。

CREATE OR REPLACE FUNCTION public.admin_api_home_counts(p_actor_id uuid, p_global_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_api_home_counts$
DECLARE
  v_tomorrow date := (now() AT TIME ZONE 'Asia/Taipei')::date + 1;
  v_reports jsonb;
  v_commentary jsonb;
  v_quiz jsonb := NULL;
  v_calendar jsonb;
  v_changes jsonb;
BEGIN
  PERFORM public.admin_api_assert_admin(p_actor_id);

  -- 回報：同 admin_api_report_list 的 counts
  SELECT jsonb_build_object(
    'open', count(*) FILTER (WHERE report.status IN ('pending', 'processing')),
    'unread', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.issue_report_messages AS message
      WHERE message.report_id = report.id AND message.author_role = 'member' AND message.is_internal_note = FALSE
        AND message.attachment_path IS DISTINCT FROM 'pending'
        AND message.created_at > COALESCE(report.admin_last_read_at, report.created_at))),
    'oldest_open_at', min(report.created_at) FILTER (WHERE report.status IN ('pending', 'processing'))
  ) INTO v_reports
  FROM public.issue_reports AS report;

  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE commentary.review_status = 'pending'),
    'approved', count(*) FILTER (WHERE commentary.review_status = 'approved')
  ) INTO v_commentary
  FROM public.passage_commentary AS commentary
  WHERE commentary.review_status IN ('pending', 'approved');

  IF p_global_plan_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.global_plans AS plan WHERE plan.id = p_global_plan_id) THEN
    v_calendar := public.get_daily_quiz_calendar(p_global_plan_id, v_tomorrow, 1, p_actor_id);
    v_quiz := jsonb_build_object(
      'enabled', COALESCE((SELECT setting.enabled FROM public.app_feature_settings AS setting WHERE setting.key = 'daily_quiz'), FALSE),
      -- 同 admin_api_plan_quiz 的 configured
      'configured', EXISTS (SELECT 1 FROM public.daily_quizzes AS quiz WHERE quiz.global_plan_id = p_global_plan_id)
        OR EXISTS (SELECT 1 FROM public.quiz_auto_publish_rules AS rule WHERE rule.global_plan_id = p_global_plan_id AND rule.enabled),
      'date', v_tomorrow,
      'status', v_calendar -> 'days' -> 0 ->> 'status',
      'needs_attention', COALESCE((v_calendar -> 'days' -> 0 ->> 'needsAttention')::boolean, FALSE)
    );
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('action', recent.action, 'occurred_at', recent.occurred_at)
      ORDER BY recent.occurred_at DESC, recent.id DESC), '[]'::jsonb)
  INTO v_changes
  FROM (
    SELECT event.id, event.action, event.occurred_at
    FROM audit.admin_events AS event
    WHERE event.result = 'ok'
      AND event.occurred_at > now() - interval '30 days'
      AND (event.action LIKE 'app_feature_settings.%'
        OR event.action LIKE 'global_plans.%'
        OR event.action IN (
          'publish_global_plan_rules', 'create_region_stage_cohort', 'set_daily_quiz_auto_publish_rule',
          'admin_save_lightning_quiz_settings', 'set_profile_managed_scopes', 'set_commentary_reviewers'))
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 5
  ) AS recent;

  RETURN jsonb_build_object(
    'reports', v_reports,
    'commentary', v_commentary,
    'quiz', v_quiz,
    'changes', v_changes
  );
END;
$admin_api_home_counts$;

REVOKE ALL ON FUNCTION public.admin_api_home_counts(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_home_counts(uuid, uuid) TO service_role;
