-- #673：計畫統計名冊改在伺服器端彙總。
--
-- get_plan_stats_roster（#397）把範圍內每一筆打卡原封不動傳回前端，管理者看全教會時約 20 萬筆、
-- 10 MB，手機還要 parse。組員總覽、組織統計樹、CSV 匯出要的其實只有每人幾個數字：
-- 這支直接回彙總（各遍章數、最後打卡、最高連續、補讀天數），只回有報名的人，不回靈修全文。
-- 舊的 get_plan_stats_roster 不改不刪：舊版前端繼續用它，新前端在這支不能用時也退回它。
--
-- 這裡每個數字都要和舊的前端算法逐人一致（scripts/db-behavior.test.mjs 的 parity 測試）：
--   · 最高連續 ＝ computePlanScopedStreak(logs, { preFiltered: true })
--       這個人所有對得上別名的報名、所有遍、不限書卷的打卡，依「看的人裝置時區」算日期。
--   · 補讀天數 ＝ countLateCompletedDays(baselineDays, startDate, buildRound1ReadDateMap(logs))
--       同上一份打卡只留第一遍；同一章多筆時留 (plan_id, id) 排最後的（前端是後面覆蓋前面）。
--   · 各遍章數、最後打卡 ＝ _executeFetchMergedUsersList 的 uniqueLogs
--       第一筆對得上別名的報名、限該報名的書卷；同一 (書卷, 章, 遍) 只算一次，留最早的時間。
--
-- 比對尺不在 SQL 裡重算：教會原始日程由前端用 getCanonicalStageScheduleDays 算好傳進來（p_schedule），
-- 日程規則仍然只有 _shared/progress 一份。遍數確認、本遍進度 % 也還是前端的共用函式算，這裡只給原始數字。
--
-- 報名的 target_books 是空的：書卷範圍要退回前端 state.globalPlans 的 books，SQL 算不出來，
-- 只有這種人照舊回逐筆打卡（l），讓前端跑同一套舊邏輯；正常的報名都有 target_books。

CREATE OR REPLACE FUNCTION public.get_plan_stats_roster_summary(
  p_plan_aliases text[],
  p_pastoral_zone text,
  p_timezone text,
  p_start_date date,
  p_schedule jsonb,
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
  -- 範圍、別名比對和 get_plan_stats_roster 一字不差
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
  -- 前端的 userPlans.find：照 id 排第一筆「字面上」對得上別名的報名；沒有計畫篩選就是第一筆
  chosen AS (
    SELECT DISTINCT ON (plans.user_id)
      plans.*,
      array_remove(array_remove(plans.target_books, ''), NULL) AS scope_books
    FROM plans
    WHERE p_plan_aliases IS NULL
      OR NULLIF(plans.preset_key, '') = ANY (p_plan_aliases)
      OR plans.global_plan_id::text = ANY (p_plan_aliases)
      OR NULLIF(plans.name, '') = ANY (p_plan_aliases)
      OR plans.id::text = ANY (p_plan_aliases)
    ORDER BY plans.user_id, plans.id
  ),
  -- 重複的書卷清單、預設代號只傳一份（整本聖經 66 卷 × 800 人）
  chosen_kinds AS (
    SELECT
      chosen.*,
      (dense_rank() OVER (ORDER BY chosen.preset_key, chosen.global_plan_id, chosen.target_books) - 1)::integer AS kind
    FROM chosen
  ),
  logs AS (
    SELECT
      log.id,
      log.user_id,
      log.plan_id,
      log.book,
      log.chapter,
      log.round,
      log.read_at,
      (log.read_at AT TIME ZONE p_timezone)::date AS read_day
    FROM public.reading_logs AS log
    WHERE (SELECT allowed FROM scope)
      AND log.plan_id IN (SELECT plans.id FROM plans)
      AND (p_whole_church IS TRUE OR log.user_id = ANY (p_visible_ids))
  ),
  -- 算章數用的那一份。沒有計畫篩選：這個人全部打卡、不限書卷（同前端）。
  scoped AS (
    SELECT logs.*
    FROM logs
    LEFT JOIN chosen ON chosen.user_id = logs.user_id
    WHERE p_plan_aliases IS NULL
      OR (
        logs.plan_id = chosen.id
        AND cardinality(chosen.target_books) > 0
        AND (cardinality(chosen.scope_books) = 0 OR logs.book = ANY (chosen.scope_books))
      )
  ),
  -- first_seen：前端 Object.values(uniqueLogsMap) 的順序（這一章第一次出現的位置）
  unique_chapters AS (
    SELECT
      scoped.user_id,
      scoped.book,
      scoped.chapter,
      scoped.round,
      min(scoped.read_at) AS read_at,
      min((scoped.plan_id::text || scoped.id::text) COLLATE "C") AS first_seen
    FROM scoped
    GROUP BY scoped.user_id, scoped.book, scoped.chapter, scoped.round
  ),
  round_counts AS (
    SELECT unique_chapters.user_id, unique_chapters.round, count(*) AS chapters
    FROM unique_chapters
    GROUP BY unique_chapters.user_id, unique_chapters.round
  ),
  by_round AS (
    SELECT round_counts.user_id, json_object_agg(round_counts.round, round_counts.chapters) AS counts
    FROM round_counts
    GROUP BY round_counts.user_id
  ),
  -- 前端用 new Date() 比（只到毫秒），同一毫秒留排在前面的
  last_read AS (
    SELECT DISTINCT ON (unique_chapters.user_id) unique_chapters.user_id, unique_chapters.read_at
    FROM unique_chapters
    ORDER BY unique_chapters.user_id, date_trunc('milliseconds', unique_chapters.read_at) DESC, unique_chapters.first_seen
  ),
  read_days AS (
    SELECT DISTINCT logs.user_id, logs.read_day
    FROM logs
  ),
  day_islands AS (
    SELECT
      read_days.user_id,
      read_days.read_day - (row_number() OVER (PARTITION BY read_days.user_id ORDER BY read_days.read_day))::integer AS island
    FROM read_days
  ),
  island_sizes AS (
    SELECT day_islands.user_id, day_islands.island, count(*) AS days
    FROM day_islands
    GROUP BY day_islands.user_id, day_islands.island
  ),
  streaks AS (
    SELECT island_sizes.user_id, max(island_sizes.days) AS best
    FROM island_sizes
    GROUP BY island_sizes.user_id
  ),
  -- p_schedule：[[第幾天（從 0 起）, 書卷, 章], …]，只列有章節的天
  schedule AS (
    SELECT DISTINCT
      (entry ->> 0)::integer AS day_index,
      entry ->> 1 AS book,
      (entry ->> 2)::integer AS chapter
    FROM jsonb_array_elements(COALESCE(p_schedule, '[]'::jsonb)) AS entry
  ),
  schedule_days AS (
    SELECT schedule.day_index, count(*) AS chapters
    FROM schedule
    GROUP BY schedule.day_index
  ),
  round1_reads AS (
    SELECT DISTINCT ON (logs.user_id, logs.book, logs.chapter)
      logs.user_id, logs.book, logs.chapter, logs.read_day
    FROM logs
    WHERE logs.round = 1
    ORDER BY logs.user_id, logs.book, logs.chapter, logs.plan_id DESC, logs.id DESC
  ),
  day_reads AS (
    SELECT round1_reads.user_id, schedule.day_index, count(*) AS chapters, max(round1_reads.read_day) AS last_day
    FROM round1_reads
    JOIN schedule ON schedule.book = round1_reads.book AND schedule.chapter = round1_reads.chapter
    GROUP BY round1_reads.user_id, schedule.day_index
  ),
  late_days AS (
    SELECT day_reads.user_id, count(*) AS days
    FROM day_reads
    JOIN schedule_days ON schedule_days.day_index = day_reads.day_index
    WHERE day_reads.chapters = schedule_days.chapters
      AND day_reads.last_day > p_start_date + day_reads.day_index
    GROUP BY day_reads.user_id
  ),
  raw_logs AS (
    SELECT
      logs.user_id,
      json_agg(json_build_array(logs.book, logs.chapter, logs.round, logs.read_at) ORDER BY logs.id) AS entries
    FROM logs
    JOIN chosen ON chosen.user_id = logs.user_id AND chosen.id = logs.plan_id
    WHERE p_plan_aliases IS NOT NULL
      AND cardinality(chosen.target_books) = 0
    GROUP BY logs.user_id
  ),
  people AS (
    SELECT
      roster.*,
      chosen_kinds.id AS plan_id,
      chosen_kinds.kind,
      chosen_kinds.current_round,
      chosen_kinds.upgrade_prompt_handled
    FROM roster
    LEFT JOIN chosen_kinds ON chosen_kinds.user_id = roster.id
    WHERE p_plan_aliases IS NULL OR chosen_kinds.id IS NOT NULL
  )
  -- 時區是必要參數：少了它日期全錯，回 NULL 讓前端退回舊路徑。
  SELECT CASE WHEN p_timezone IS NULL THEN NULL ELSE json_build_object(
    'tz', p_timezone,
    'roles', (
      SELECT COALESCE(json_agg(json_build_array(role_rows.id, role_rows.code, role_rows.label) ORDER BY role_rows.id), '[]'::json)
      FROM (
        SELECT DISTINCT people.role_definition_id AS id, people.role_definition_code AS code, people.role_definition_label AS label
        FROM people
        WHERE people.role_definition_id IS NOT NULL
      ) AS role_rows
    ),
    'plans', (
      SELECT COALESCE(json_agg(json_build_array(kinds.preset_key, kinds.global_plan_id, kinds.target_books) ORDER BY kinds.kind), '[]'::json)
      FROM (
        SELECT DISTINCT chosen_kinds.kind, chosen_kinds.preset_key, chosen_kinds.global_plan_id, chosen_kinds.target_books
        FROM chosen_kinds
      ) AS kinds
    ),
    'people', (
      SELECT COALESCE(json_agg(json_build_object(
        'i', people.id,
        'n', people.name,
        'r', people.great_region,
        'z', people.pastoral_zone,
        'g', people.small_group,
        'ri', people.role_id,
        'p', people.plan_id,
        't', people.kind,
        'c', people.current_round,
        'h', people.upgrade_prompt_handled,
        'b', by_round.counts,
        'a', last_read.read_at,
        's', COALESCE(streaks.best, 0),
        'm', CASE WHEN p_schedule IS NULL THEN NULL ELSE COALESCE(late_days.days, 0) END,
        'l', raw_logs.entries
      ) ORDER BY people.id), '[]'::json)
      FROM people
      LEFT JOIN by_round ON by_round.user_id = people.id
      LEFT JOIN last_read ON last_read.user_id = people.id
      LEFT JOIN streaks ON streaks.user_id = people.id
      LEFT JOIN late_days ON late_days.user_id = people.id
      LEFT JOIN raw_logs ON raw_logs.user_id = people.id
    )
  ) END;
$function$;

-- 只讓 nlc-data 呼叫：範圍（p_whole_church、p_visible_ids、p_actor_id）由它依登入者注入，前端傳的一律不看。
REVOKE ALL ON FUNCTION public.get_plan_stats_roster_summary(text[], text, text, date, jsonb, boolean, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_plan_stats_roster_summary(text[], text, text, date, jsonb, boolean, uuid[], uuid) TO service_role;
