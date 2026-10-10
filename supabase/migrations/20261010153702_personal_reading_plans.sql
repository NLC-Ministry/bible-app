-- #473 個人計畫：每位使用者都能建立只屬於自己的讀經計畫。
--
-- 沿用 reading_plans，不另開表：reading_logs.plan_id 的外鍵與唯一限制綁 reading_plans(id)，
-- 另開表就得複製整套打卡流程；正式站的存取控制是 nlc-data 的 applyForcedScope，
-- reading_plans 已經是 OWN_WRITE_TABLES（user_id 由伺服器強制），不必放寬任何權限。
--
-- 1. is_personal：明確標記個人計畫。舊資料一律 false——不能用「global_plan_id 與
--    preset_key 都是空的」推斷，舊版預設計畫也有這種列（用名稱對應）。
-- 2. CHECK：個人計畫不掛任何教會計畫（global_plan_id、preset_key 都要空）。
-- 3. 觸發器 enforce_personal_plan_rules：
--    - 每人最多 5 個「進行中」（end_date ≥ 今天，台北時間）的個人計畫；已結束的不算。
--      只在前端擋的話，直接呼叫 API 就能繞過。同一人的寫入用 advisory lock 排隊，
--      兩個分頁同時新增不會一起過關。
--    - is_personal 建立後不能改（不能把教會計畫的報名列改成個人計畫，反之亦然）。
--    - 個人計畫有打卡紀錄後，書卷與日期鎖住（改名、每週讀經安排照常可改）。
-- 4. 排行榜、團隊、教會統計排除個人計畫。依 global_plan_id 查的函式（排行榜、團隊、
--    報名統計、大測驗統計……）本來就碰不到個人計畫；這裡改的是沒有綁教會計畫的六支：
--    admin_get_reading_activity / _l7 / admin_get_reading_hour_heatmap（掃全體打卡）、
--    _user_read_book_once（大測驗「讀完一遍」篩選）、get_plan_stats_roster（會用計畫名稱
--    比對，p_plan_aliases 為 NULL 時取全部計畫）、get_admin_user_directory（使用者參加的計畫）。
--
-- 純新增：舊版前端不送 is_personal，DEFAULT false 下觸發器與 CHECK 都不作用。
-- 新版前端開機會查 is_personal，所以這支要比前端先上（或同時）；前端查不到這個欄位時
-- 會退回不含 is_personal 的查詢，計畫清單不會因此載不出來。

ALTER TABLE public.reading_plans
  ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.reading_plans
  DROP CONSTRAINT IF EXISTS reading_plans_personal_not_church_plan;
ALTER TABLE public.reading_plans
  ADD CONSTRAINT reading_plans_personal_not_church_plan
  CHECK (NOT is_personal OR (global_plan_id IS NULL AND preset_key IS NULL));

-- 上限計數與統計排除都只看個人計畫，部分索引讓它們不必掃整張表。
CREATE INDEX IF NOT EXISTS idx_reading_plans_personal
  ON public.reading_plans(user_id, end_date)
  WHERE is_personal;

CREATE OR REPLACE FUNCTION public.enforce_personal_plan_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_personal_plan_rules$
DECLARE
  taipei_today DATE := (now() AT TIME ZONE 'Asia/Taipei')::DATE;
  active_count INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_personal IS DISTINCT FROM OLD.is_personal THEN
    RAISE EXCEPTION 'personal_plan_flag_immutable'
      USING ERRCODE = 'check_violation',
            HINT = 'is_personal 只能在建立時決定。';
  END IF;

  IF NOT NEW.is_personal THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (NEW.target_books IS DISTINCT FROM OLD.target_books
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.end_date IS DISTINCT FROM OLD.end_date
      OR NEW.is_fixed IS DISTINCT FROM OLD.is_fixed)
    AND EXISTS (SELECT 1 FROM public.reading_logs AS log WHERE log.plan_id = NEW.id)
  THEN
    RAISE EXCEPTION 'personal_plan_locked_after_first_log'
      USING ERRCODE = 'check_violation',
            HINT = '個人計畫開始打卡後，書卷與日期就不能再改。';
  END IF;

  -- 已結束的不算；原本就在計數裡的（同一人、原本就還沒結束）改日期不會多佔名額。
  IF NEW.end_date < taipei_today THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.end_date >= taipei_today AND OLD.user_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('personal_plan_limit:' || NEW.user_id::TEXT, 0));

  SELECT COUNT(*) INTO active_count
  FROM public.reading_plans AS plan
  WHERE plan.user_id = NEW.user_id
    AND plan.is_personal
    AND plan.end_date >= taipei_today
    AND plan.id <> NEW.id;

  IF active_count >= 5 THEN
    RAISE EXCEPTION 'personal_plan_limit_reached'
      USING ERRCODE = 'check_violation',
            HINT = '每人最多 5 個進行中的個人計畫，已結束的不算。';
  END IF;

  RETURN NEW;
END;
$enforce_personal_plan_rules$;

REVOKE ALL ON FUNCTION public.enforce_personal_plan_rules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_personal_plan_rules() TO service_role;

DROP TRIGGER IF EXISTS trg_reading_plans_personal_rules ON public.reading_plans;
CREATE TRIGGER trg_reading_plans_personal_rules
  BEFORE INSERT OR UPDATE OF is_personal, user_id, target_books, start_date, end_date, is_fixed
  ON public.reading_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_personal_plan_rules();

-- ---------------------------------------------------------------------------
-- 以下六支照上一版原樣重新定義，只加「排除個人計畫」的條件（標 #473 的那幾行）。
-- ---------------------------------------------------------------------------

-- admin_get_reading_activity（上一版：20261007110629_reading_activity_dau_wau_mau.sql）
CREATE OR REPLACE FUNCTION public.admin_get_reading_activity(
  p_from DATE,
  p_to DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  scan_from DATE;
  days_j JSONB;
BEGIN
  IF public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'reading_activity_admin_required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'reading_activity_invalid_range';
  END IF;
  IF p_to - p_from > 179 THEN
    RAISE EXCEPTION 'reading_activity_range_too_long';
  END IF;
  scan_from := p_from - 29;

  WITH user_days AS (
    SELECT l.user_id, (l.read_at AT TIME ZONE 'Asia/Taipei')::DATE AS d
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.reading_plans rp WHERE rp.id = l.plan_id AND rp.is_personal) -- #473
      AND l.read_at >= (scan_from::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
    GROUP BY 1, 2
  ),
  spans AS (
    SELECT d, LEAD(d) OVER (PARTITION BY user_id ORDER BY d) AS next_d
    FROM user_days
  ),
  events AS (
    SELECT d AS day, 1 AS dau, 1 AS wau, 1 AS mau FROM spans
    UNION ALL
    SELECT LEAST(next_d, d + 7), 0, -1, 0 FROM spans
    UNION ALL
    SELECT LEAST(next_d, d + 30), 0, 0, -1 FROM spans
  ),
  per_day AS (
    SELECT day, SUM(dau) AS dau, SUM(wau) AS wau_delta, SUM(mau) AS mau_delta
    FROM events GROUP BY day
  ),
  running AS (
    SELECT c.day,
           COALESCE(p.dau, 0) AS dau,
           SUM(COALESCE(p.wau_delta, 0)) OVER (ORDER BY c.day) AS wau,
           SUM(COALESCE(p.mau_delta, 0)) OVER (ORDER BY c.day) AS mau
    FROM generate_series(scan_from, p_to, INTERVAL '1 day') AS g(ts)
    CROSS JOIN LATERAL (SELECT g.ts::DATE AS day) c
    LEFT JOIN per_day p ON p.day = c.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'date', r.day::TEXT,
      'dau', r.dau,
      'wau', r.wau,
      'mau', r.mau
    ) ORDER BY r.day), '[]'::jsonb)
  INTO days_j
  FROM running r
  WHERE r.day >= p_from;

  RETURN jsonb_build_object('from', p_from::TEXT, 'to', p_to::TEXT, 'days', days_j);
END;
$$;

-- admin_get_reading_activity_l7（上一版：20261007110640_reading_activity_l7.sql）
CREATE OR REPLACE FUNCTION public.admin_get_reading_activity_l7(
  p_end DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  week_start DATE;
  prev_start DATE;
  result_j   JSONB;
BEGIN
  IF public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'reading_activity_admin_required';
  END IF;
  IF p_end IS NULL THEN
    RAISE EXCEPTION 'reading_activity_invalid_range';
  END IF;
  week_start := date_trunc('week', p_end)::DATE;
  prev_start := week_start - 7;

  WITH user_days AS (
    SELECT l.user_id, (l.read_at AT TIME ZONE 'Asia/Taipei')::DATE AS d
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.reading_plans rp WHERE rp.id = l.plan_id AND rp.is_personal) -- #473
      AND l.read_at >= (prev_start::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_end + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
    GROUP BY 1, 2
  ),
  per_user AS (
    SELECT CASE WHEN d >= week_start THEN 'current' ELSE 'previous' END AS which,
           user_id,
           COUNT(*) AS active_days
    FROM user_days
    GROUP BY 1, 2
  ),
  buckets AS (
    SELECT w.which, b.days, COUNT(pu.user_id) AS users
    FROM (VALUES ('current'), ('previous')) AS w(which)
    CROSS JOIN generate_series(1, 7) AS b(days)
    LEFT JOIN per_user pu ON pu.which = w.which AND pu.active_days = b.days
    GROUP BY w.which, b.days
  )
  SELECT jsonb_object_agg(w.which, jsonb_build_object(
      'weekStart', w.ws::TEXT,
      'weekEnd', (w.ws + 6)::TEXT,
      'coveredEnd', w.covered_end::TEXT,
      'dayCount', w.covered_end - w.ws + 1,
      'total', (SELECT COALESCE(SUM(users), 0) FROM buckets b WHERE b.which = w.which),
      'buckets', (SELECT jsonb_agg(jsonb_build_object('days', b.days, 'users', b.users) ORDER BY b.days)
                  FROM buckets b WHERE b.which = w.which)
    ))
  INTO result_j
  FROM (VALUES ('current', week_start, p_end),
               ('previous', prev_start, week_start - 1)) AS w(which, ws, covered_end);

  RETURN result_j;
END;
$$;

-- admin_get_reading_hour_heatmap（上一版：20261007110649_reading_hour_heatmap.sql）
CREATE OR REPLACE FUNCTION public.admin_get_reading_hour_heatmap(
  p_from DATE,
  p_to DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  cells_j  JSONB;
  counts_j JSONB;
BEGIN
  IF public.role_code((SELECT role_id FROM public.profiles WHERE id = actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'reading_activity_admin_required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'reading_activity_invalid_range';
  END IF;
  IF p_to - p_from > 179 THEN
    RAISE EXCEPTION 'reading_activity_range_too_long';
  END IF;

  WITH logs AS (
    SELECT l.user_id, l.read_at AT TIME ZONE 'Asia/Taipei' AS t
    FROM public.reading_logs l
    WHERE l.plan_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.reading_plans rp WHERE rp.id = l.plan_id AND rp.is_personal) -- #473
      AND l.read_at >= (p_from::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
      AND l.read_at < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Taipei')
  ),
  per_day_hour AS (
    SELECT t::DATE AS d,
           EXTRACT(HOUR FROM t)::INT AS h,
           COUNT(DISTINCT user_id) AS users,
           COUNT(*) AS chapters
    FROM logs
    GROUP BY 1, 2
  ),
  per_cell AS (
    SELECT EXTRACT(ISODOW FROM d)::INT AS dow, h,
           SUM(users) AS sum_users, SUM(chapters) AS sum_chapters
    FROM per_day_hour
    GROUP BY 1, 2
  )
  SELECT jsonb_agg(jsonb_build_object(
      'dow', g.dow,
      'hour', g.h,
      'sumUsers', COALESCE(c.sum_users, 0),
      'sumChapters', COALESCE(c.sum_chapters, 0)
    ) ORDER BY g.dow, g.h)
  INTO cells_j
  FROM generate_series(1, 7) AS g_dow(dow)
  CROSS JOIN generate_series(0, 23) AS g_h(h)
  CROSS JOIN LATERAL (SELECT g_dow.dow, g_h.h) g
  LEFT JOIN per_cell c ON c.dow = g.dow AND c.h = g.h;

  SELECT jsonb_object_agg(dow::TEXT, cnt)
  INTO counts_j
  FROM (
    SELECT g.dow, COUNT(dd.d) AS cnt
    FROM generate_series(1, 7) AS g(dow)
    LEFT JOIN (
      SELECT x::DATE AS d FROM generate_series(p_from, p_to, INTERVAL '1 day') AS x
    ) dd ON EXTRACT(ISODOW FROM dd.d)::INT = g.dow
    GROUP BY g.dow
  ) s;

  RETURN jsonb_build_object('from', p_from::TEXT, 'to', p_to::TEXT, 'cells', cells_j, 'dayCounts', counts_j);
END;
$$;

-- _user_read_book_once（上一版：0170_exam_paper_linked_plan.sql）
CREATE OR REPLACE FUNCTION public._user_read_book_once(p_user_id UUID, p_book TEXT, p_chapters INTEGER)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT p_user_id IS NULL OR p_book IS NULL OR BTRIM(p_book) = '' OR EXISTS (
    SELECT 1 FROM public.reading_plans rp
    WHERE rp.user_id = p_user_id
      AND NOT rp.is_personal -- #473
      AND p_book = ANY(rp.target_books)
      AND (
        rp.current_round >= 2
        OR (
          p_chapters IS NOT NULL AND p_chapters > 0
          AND (SELECT COUNT(DISTINCT l.chapter) FROM public.reading_logs l
               WHERE l.user_id = p_user_id AND l.book = p_book AND COALESCE(l.round, 1) = 1
                 AND NOT EXISTS (SELECT 1 FROM public.reading_plans own WHERE own.id = l.plan_id AND own.is_personal) -- #473
              ) >= p_chapters
        )
      )
  )
$$;

-- get_plan_stats_roster（上一版：20261002052232_plan_stats_roster.sql）
CREATE OR REPLACE FUNCTION public.get_plan_stats_roster(
  p_plan_aliases text[],
  p_pastoral_zone text,
  p_note_date date,
  p_whole_church boolean,
  p_visible_ids uuid[],
  p_actor_id uuid
)
 RETURNS json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH scope AS (
    SELECT (
      p_actor_id IS NOT NULL
      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)
    ) AS allowed
  ),
  uuid_aliases AS (
    SELECT alias::uuid AS id
    FROM unnest(COALESCE(p_plan_aliases, '{}'::text[])) AS alias
    WHERE alias ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  ),
  roster AS (
    SELECT
      prof.id,
      prof.name,
      prof.great_region,
      prof.pastoral_zone,
      prof.small_group,
      prof.role_id,
      role_def.id AS role_definition_id,
      role_def.code AS role_definition_code,
      role_def.label AS role_definition_label
    FROM public.profiles AS prof
    LEFT JOIN public.role_definitions AS role_def ON role_def.id = prof.role_id
    WHERE (SELECT allowed FROM scope)
      AND (p_whole_church IS TRUE OR prof.id = ANY (p_visible_ids))
      AND (NULLIF(p_pastoral_zone, '') IS NULL OR prof.pastoral_zone = p_pastoral_zone)
  ),
  plans AS (
    SELECT
      plan.id,
      plan.user_id,
      plan.name,
      plan.preset_key,
      plan.global_plan_id,
      plan.target_books,
      plan.current_round,
      plan.upgrade_prompt_handled
    FROM public.reading_plans AS plan
    WHERE (SELECT allowed FROM scope)
      AND NOT plan.is_personal -- #473
      AND (p_whole_church IS TRUE OR plan.user_id = ANY (p_visible_ids))
      AND (NULLIF(p_pastoral_zone, '') IS NULL OR plan.user_id IN (SELECT roster.id FROM roster))
      AND (
        p_plan_aliases IS NULL
        OR plan.preset_key = ANY (p_plan_aliases)
        OR plan.name = ANY (p_plan_aliases)
        OR plan.global_plan_id IN (SELECT uuid_aliases.id FROM uuid_aliases)
        OR plan.id IN (SELECT uuid_aliases.id FROM uuid_aliases)
      )
  ),
  log_groups AS (
    SELECT
      log.user_id,
      log.plan_id,
      json_agg(json_build_array(log.book, log.chapter, log.round, log.read_at) ORDER BY log.id) AS logs
    FROM public.reading_logs AS log
    WHERE (SELECT allowed FROM scope)
      AND log.plan_id IN (SELECT plans.id FROM plans)
      AND (p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))
    GROUP BY log.user_id, log.plan_id
  ),
  notes AS (
    SELECT note.id, note.user_id, note.content
    FROM public.devotional_notes AS note
    WHERE (SELECT allowed FROM scope)
      AND p_note_date IS NOT NULL
      AND note.note_date = p_note_date
      AND note.user_id IN (SELECT roster.id FROM roster)
  )
  SELECT json_build_object(
    'profiles', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', roster.id,
        'name', roster.name,
        'great_region', roster.great_region,
        'pastoral_zone', roster.pastoral_zone,
        'small_group', roster.small_group,
        'role_id', roster.role_id,
        'role_definition', CASE WHEN roster.role_definition_id IS NULL THEN NULL ELSE json_build_object(
          'id', roster.role_definition_id,
          'code', roster.role_definition_code,
          'label', roster.role_definition_label
        ) END
      ) ORDER BY roster.id), '[]'::json)
      FROM roster
    ),
    'plans', (
      SELECT COALESCE(json_agg(json_build_object(
        'id', plans.id,
        'user_id', plans.user_id,
        'name', plans.name,
        'preset_key', plans.preset_key,
        'global_plan_id', plans.global_plan_id,
        'target_books', plans.target_books,
        'current_round', plans.current_round,
        'upgrade_prompt_handled', plans.upgrade_prompt_handled
      ) ORDER BY plans.id), '[]'::json)
      FROM plans
    ),
    'logs', (
      SELECT COALESCE(
        json_agg(json_build_object('u', log_groups.user_id, 'p', log_groups.plan_id, 'l', log_groups.logs)
                 ORDER BY log_groups.user_id, log_groups.plan_id),
        '[]'::json
      )
      FROM log_groups
    ),
    'notes', (
      SELECT COALESCE(json_agg(json_build_array(notes.user_id, notes.content) ORDER BY notes.id), '[]'::json)
      FROM notes
    )
  );
$function$;

-- get_admin_user_directory（上一版：20261002023615_admin_user_directory.sql）
CREATE OR REPLACE FUNCTION public.get_admin_user_directory(
  p_include_plan_details boolean DEFAULT false,
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_actor_id IS NULL THEN NULL ELSE json_build_object(
    'e', COALESCE(p_include_plan_details, false),
    'p', COALESCE((
      SELECT json_agg(json_build_object(
          'i', profile.id,
          'n', profile.name,
          'm', profile.email,
          'r', profile.great_region,
          'z', profile.pastoral_zone,
          'g', profile.small_group,
          'a', profile.is_active,
          's', profile.member_context_synced_at,
          'ss', profile.member_context_sync_status,
          'ri', profile.role_id,
          'rd', CASE WHEN role_def.id IS NULL THEN NULL
                     ELSE json_build_array(role_def.id, role_def.code, role_def.label, role_def.scope_type) END,
          'mr', profile.managed_regions,
          'mz', profile.managed_zones,
          'mg', profile.managed_groups,
          'j', CASE WHEN p_include_plan_details THEN (
                 SELECT json_agg(json_build_array(plan.global_plan_id, plan.preset_key) ORDER BY plan.id)
                 FROM public.reading_plans AS plan
                 WHERE plan.user_id = profile.id
                   AND NOT plan.is_personal -- #473
               ) END,
          't', CASE WHEN p_include_plan_details THEN (
                 SELECT json_agg(json_build_array(member.global_plan_id, team.name, member.member_role) ORDER BY member.team_id)
                 FROM public.reading_team_members AS member
                 LEFT JOIN public.reading_teams AS team ON team.id = member.team_id
                 WHERE member.user_id = profile.id
                   AND member.global_plan_id IS NOT NULL
               ) END
        ) ORDER BY profile.name, profile.id)
      FROM public.profiles AS profile
      LEFT JOIN public.role_definitions AS role_def ON role_def.id = profile.role_id
    ), '[]'::json)
  ) END;
$function$;


-- 權限照上一版：CREATE OR REPLACE 會保留既有權限，這裡仍明確重下一次（CLAUDE.md 規則）。
-- _user_read_book_once 上一版只 REVOKE FROM PUBLIC，這次一併收回 anon。
REVOKE ALL ON FUNCTION public.admin_get_reading_activity(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_activity(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_reading_activity_l7(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_activity_l7(date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_reading_hour_heatmap(date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_reading_hour_heatmap(date, date, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._user_read_book_once(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_read_book_once(uuid, text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_plan_stats_roster(text[], text, date, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_stats_roster(text[], text, date, boolean, uuid[], uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_admin_user_directory(boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_user_directory(boolean, uuid) TO service_role;
