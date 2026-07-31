-- Full production data integrity audit (READ ONLY)
--
-- Usage:
--   1. Apply migrations through 0054_managed_scope_authority.sql first.
--   2. Run this whole file in the Supabase SQL Editor as a project owner.
--   3. A clean database returns one PASS row with issue_count = 0.
--   4. Fix ERROR rows first. WARNING rows need human review.
--
-- This query does not INSERT, UPDATE, DELETE, CREATE, or ALTER anything.

WITH
role_by_profile AS (
  SELECT
    profile.*,
    definition.code AS role_code,
    definition.label AS role_label
  FROM public.profiles AS profile
  LEFT JOIN public.role_definitions AS definition ON definition.id = profile.role_id
),
identity_counts AS (
  SELECT
    identity.profile_id,
    COUNT(*) AS identity_count,
    COUNT(*) FILTER (WHERE identity.provider = 'logto') AS logto_count,
    COUNT(*) FILTER (WHERE identity.is_primary) AS primary_count
  FROM public.user_identities AS identity
  GROUP BY identity.profile_id
),
team_counts AS (
  SELECT
    team.id AS team_id,
    COUNT(member.user_id) AS member_count,
    COUNT(member.user_id) FILTER (WHERE member.member_role = 'captain') AS captain_count,
    COUNT(member.user_id) FILTER (
      WHERE member.member_role = 'captain' AND member.user_id = team.captain_id
    ) AS matching_captain_count
  FROM public.reading_teams AS team
  LEFT JOIN public.reading_team_members AS member
    ON member.team_id = team.id
   AND member.global_plan_id = team.global_plan_id
   AND member.division = team.division
  GROUP BY team.id
),
small_home_team_counts AS (
  SELECT
    team.id AS team_id,
    team.global_plan_id,
    COUNT(member.user_id) AS member_count
  FROM public.small_home_teams AS team
  LEFT JOIN public.small_home_team_members AS member ON member.team_id = team.id
  GROUP BY team.id, team.global_plan_id
),
issues AS (
  -- -----------------------------------------------------------------------
  -- Schema and authorization configuration
  -- -----------------------------------------------------------------------
  SELECT
    'ERROR'::TEXT AS severity,
    'schema'::TEXT AS area,
    'LATEST_SCOPE_RPC_MISSING'::TEXT AS check_code,
    NULL::TEXT AS record_id,
    'set_profile_managed_scopes'::TEXT AS record_label,
    JSONB_BUILD_OBJECT('expectedMigration', '0054_managed_scope_authority.sql') AS details,
    '先套用最新 migration，再執行資料健檢。'::TEXT AS suggested_action
  WHERE TO_REGPROCEDURE('public.set_profile_managed_scopes(uuid,text[],text[],text[])') IS NULL

  UNION ALL

  SELECT
    'ERROR', 'roles', 'SATELLITE_ADMIN_ALIAS_MISSING',
    definition.id::TEXT, definition.label,
    JSONB_BUILD_OBJECT('roleCode', definition.code, 'hubPermissionKeys', definition.hub_permission_keys),
    '確認 0053 migration 已將 satellite_admin 加入 admin.hub_permission_keys。'
  FROM public.role_definitions AS definition
  WHERE definition.code = 'admin'
    AND NOT ('satellite_admin' = ANY(definition.hub_permission_keys))

  UNION ALL

  SELECT
    'ERROR', 'roles', 'REQUIRED_ROLE_DEFINITION_MISSING',
    NULL, expected.code,
    JSONB_BUILD_OBJECT('expectedCode', expected.code),
    '補齊標準 role_definitions；不要直接在 profiles 建立自訂角色文字。'
  FROM (
    VALUES
      ('member'), ('group_leader'), ('zone_leader'),
      ('great_zone_leader'), ('senior_pastor'), ('admin')
  ) AS expected(code)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.role_definitions AS definition WHERE definition.code = expected.code
  )

  -- -----------------------------------------------------------------------
  -- Profiles, Member Hub identities, and role projection
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'profiles', 'PROFILE_ROLE_LINK_BROKEN',
    profile.id::TEXT, NULLIF(BTRIM(profile.name), ''),
    JSONB_BUILD_OBJECT('roleId', profile.role_id),
    '將 role_id 修正為既有 role_definitions UUID；不要建立第二套角色欄位。'
  FROM role_by_profile AS profile
  WHERE profile.role_code IS NULL

  UNION ALL

  SELECT
    'ERROR', 'profiles', 'ACTIVE_PROFILE_NAME_BLANK',
    profile.id::TEXT, profile.email,
    JSONB_BUILD_OBJECT('isDemo', profile.is_demo, 'isActive', profile.is_active),
    '從會員中心重新同步 displayName，或確認此帳號是否應停用。'
  FROM role_by_profile AS profile
  WHERE profile.is_active = TRUE
    AND profile.is_demo = FALSE
    AND BTRIM(COALESCE(profile.name, '')) = ''

  UNION ALL

  SELECT
    'WARNING', 'profiles', 'DUPLICATE_ACTIVE_EMAIL',
    NULL, duplicate.email_key,
    JSONB_BUILD_OBJECT('profileIds', duplicate.profile_ids, 'count', duplicate.profile_count),
    '逐筆確認是否為同一會員；只能透過強連結 memberId/Logto subject 合併，不能只靠 Email 自動合併。'
  FROM (
    SELECT
      LOWER(BTRIM(profile.email)) AS email_key,
      ARRAY_AGG(profile.id ORDER BY profile.created_at) AS profile_ids,
      COUNT(*) AS profile_count
    FROM public.profiles AS profile
    WHERE profile.is_active = TRUE
      AND profile.is_demo = FALSE
      AND NULLIF(BTRIM(profile.email), '') IS NOT NULL
    GROUP BY LOWER(BTRIM(profile.email))
    HAVING COUNT(*) > 1
  ) AS duplicate

  UNION ALL

  SELECT
    'ERROR', 'identities', 'MULTIPLE_LOGTO_IDENTITIES_FOR_PROFILE',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT('logtoCount', counts.logto_count),
    '確認是否誤把多個教會會員身分連到同一 profile。'
  FROM role_by_profile AS profile
  JOIN identity_counts AS counts ON counts.profile_id = profile.id
  WHERE counts.logto_count > 1

  UNION ALL

  SELECT
    'ERROR', 'identities', 'PRIMARY_IDENTITY_COUNT_INVALID',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'identityCount', counts.identity_count,
      'primaryCount', counts.primary_count
    ),
    '每個有 identity 的 profile 應恰好有一筆 is_primary = true。'
  FROM role_by_profile AS profile
  JOIN identity_counts AS counts ON counts.profile_id = profile.id
  WHERE counts.identity_count > 0
    AND counts.primary_count <> 1

  UNION ALL

  SELECT
    'ERROR', 'member_hub_sync', 'SUCCESS_SYNC_WITHOUT_STRONG_LINK',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'nlcMemberId', profile.nlc_member_id,
      'hasLogtoIdentity', EXISTS (
        SELECT 1
        FROM public.user_identities AS identity
        WHERE identity.profile_id = profile.id AND identity.provider = 'logto'
      )
    ),
    '重新登入觸發 nlc-session；成功同步必須留下 memberId 與 Logto identity。'
  FROM role_by_profile AS profile
  WHERE profile.is_demo = FALSE
    AND profile.member_context_sync_status = 'success'
    AND (
      profile.nlc_member_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.user_identities AS identity
        WHERE identity.profile_id = profile.id AND identity.provider = 'logto'
      )
    )

  UNION ALL

  SELECT
    'ERROR', 'member_hub_sync', 'IDENTITY_ROLE_PROJECTION_MISMATCH',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'profileRoleId', profile.role_id,
      'projectedRoleId', identity.metadata #>> '{role_resolution,role_id}',
      'projectedRoleCode', identity.metadata #>> '{role_resolution,role_code}'
    ),
    '重新登入同步角色；若仍不一致，檢查 nlc-session role resolution log。'
  FROM role_by_profile AS profile
  JOIN public.user_identities AS identity
    ON identity.profile_id = profile.id
   AND identity.provider = 'logto'
   AND identity.is_primary = TRUE
  WHERE NULLIF(identity.metadata #>> '{role_resolution,role_id}', '') IS NOT NULL
    AND identity.metadata #>> '{role_resolution,role_id}' <> profile.role_id::TEXT

  UNION ALL

  SELECT
    'ERROR', 'member_hub_sync', 'VERIFIED_SATELLITE_ADMIN_NOT_LOCAL_ADMIN',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'localRole', profile.role_code,
      'satelliteAdminVerified', identity.metadata #>> '{role_resolution,satellite_admin_verified}'
    ),
    '確認 admin 定義含 satellite_admin，然後重新登入同步。'
  FROM role_by_profile AS profile
  JOIN public.user_identities AS identity
    ON identity.profile_id = profile.id
   AND identity.provider = 'logto'
   AND identity.is_primary = TRUE
  WHERE identity.metadata #>> '{role_resolution,satellite_admin_verified}' = 'true'
    AND profile.role_code IS DISTINCT FROM 'admin'

  UNION ALL

  SELECT
    'WARNING', 'member_hub_sync', 'LATEST_SYNC_DEGRADED_OR_FAILED',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'syncStatus', profile.member_context_sync_status,
      'syncError', profile.member_context_sync_error,
      'attemptedAt', profile.member_context_sync_attempted_at
    ),
    '先確認會員中心 API 回應，再重新登入；不要直接覆寫同步欄位。'
  FROM role_by_profile AS profile
  WHERE profile.is_active = TRUE
    AND profile.is_demo = FALSE
    AND profile.member_context_sync_status IN ('degraded', 'failed')

  -- -----------------------------------------------------------------------
  -- Organization placement and managed scopes
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'organization', 'GREAT_REGION_ID_NAME_MISMATCH',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'greatRegionId', profile.great_region_id,
      'profileName', profile.great_region,
      'linkedName', region.name
    ),
    '重新執行會員中心組織同步，讓 UUID 與顯示名稱由同一節點產生。'
  FROM role_by_profile AS profile
  JOIN public.great_regions AS region ON region.id = profile.great_region_id
  WHERE BTRIM(COALESCE(profile.great_region, '')) <> BTRIM(region.name)

  UNION ALL

  SELECT
    'ERROR', 'organization', 'PASTORAL_ZONE_ID_NAME_MISMATCH',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'pastoralZoneId', profile.pastoral_zone_id,
      'profileName', profile.pastoral_zone,
      'linkedName', zone.name
    ),
    '重新執行會員中心組織同步。'
  FROM role_by_profile AS profile
  JOIN public.pastoral_zones AS zone ON zone.id = profile.pastoral_zone_id
  WHERE BTRIM(COALESCE(profile.pastoral_zone, '')) <> BTRIM(zone.name)

  UNION ALL

  SELECT
    'ERROR', 'organization', 'SMALL_GROUP_ID_NAME_MISMATCH',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'smallGroupId', profile.small_group_id,
      'profileName', profile.small_group,
      'linkedName', small_group.name
    ),
    '重新執行會員中心組織同步。'
  FROM role_by_profile AS profile
  JOIN public.small_groups AS small_group ON small_group.id = profile.small_group_id
  WHERE BTRIM(COALESCE(profile.small_group, '')) <> BTRIM(small_group.name)

  UNION ALL

  SELECT
    'ERROR', 'organization', 'ORG_ID_CHAIN_MISMATCH',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'greatRegionId', profile.great_region_id,
      'zoneRegionId', zone.great_region_id,
      'pastoralZoneId', profile.pastoral_zone_id,
      'groupZoneId', small_group.pastoral_zone_id,
      'smallGroupId', profile.small_group_id
    ),
    '修正組織節點連結；小組必須屬於該牧區，牧區必須屬於該大區。'
  FROM role_by_profile AS profile
  LEFT JOIN public.pastoral_zones AS zone ON zone.id = profile.pastoral_zone_id
  LEFT JOIN public.small_groups AS small_group ON small_group.id = profile.small_group_id
  WHERE (
      profile.great_region_id IS NOT NULL
      AND profile.pastoral_zone_id IS NOT NULL
      AND zone.great_region_id IS DISTINCT FROM profile.great_region_id
    )
    OR (
      profile.pastoral_zone_id IS NOT NULL
      AND profile.small_group_id IS NOT NULL
      AND small_group.pastoral_zone_id IS DISTINCT FROM profile.pastoral_zone_id
    )

  UNION ALL

  SELECT
    'WARNING', 'organization', 'ORG_TEXT_WITHOUT_CANONICAL_ID',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'greatRegion', profile.great_region,
      'greatRegionId', profile.great_region_id,
      'pastoralZone', profile.pastoral_zone,
      'pastoralZoneId', profile.pastoral_zone_id,
      'smallGroup', profile.small_group,
      'smallGroupId', profile.small_group_id
    ),
    '文字欄位有值但 UUID 未連結；重新同步並確認組織主檔存在同名節點。'
  FROM role_by_profile AS profile
  WHERE (NULLIF(BTRIM(profile.great_region), '') IS NOT NULL AND profile.great_region_id IS NULL)
     OR (NULLIF(BTRIM(profile.pastoral_zone), '') IS NOT NULL AND profile.pastoral_zone_id IS NULL)
     OR (NULLIF(BTRIM(profile.small_group), '') IS NOT NULL AND profile.small_group_id IS NULL)

  UNION ALL

  SELECT
    'ERROR', 'managed_scopes', 'UNKNOWN_MANAGED_REGION',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT('roleCode', profile.role_code, 'unknownRegion', scope.value),
    '在後台重新選擇有效大區；不要保留已不存在的文字。'
  FROM role_by_profile AS profile
  CROSS JOIN LATERAL REGEXP_SPLIT_TO_TABLE(profile.managed_regions, '\s*,\s*') AS scope(value)
  WHERE NULLIF(BTRIM(scope.value), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.great_regions AS region WHERE region.name = BTRIM(scope.value)
    )

  UNION ALL

  SELECT
    'ERROR', 'managed_scopes', 'UNKNOWN_MANAGED_ZONE',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT('roleCode', profile.role_code, 'unknownZone', scope.value),
    '在後台重新選擇有效牧區。'
  FROM role_by_profile AS profile
  CROSS JOIN LATERAL REGEXP_SPLIT_TO_TABLE(profile.managed_zones, '\s*,\s*') AS scope(value)
  WHERE NULLIF(BTRIM(scope.value), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.pastoral_zones AS zone WHERE zone.name = BTRIM(scope.value)
    )

  UNION ALL

  SELECT
    'ERROR', 'managed_scopes', 'UNKNOWN_MANAGED_GROUP',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT('roleCode', profile.role_code, 'unknownGroup', scope.value),
    '在後台重新選擇有效小組。'
  FROM role_by_profile AS profile
  CROSS JOIN LATERAL REGEXP_SPLIT_TO_TABLE(profile.managed_groups, '\s*,\s*') AS scope(value)
  WHERE NULLIF(BTRIM(scope.value), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.small_groups AS small_group WHERE small_group.name = BTRIM(scope.value)
    )

  UNION ALL

  SELECT
    'WARNING', 'managed_scopes', 'SCOPE_COLUMN_DOES_NOT_MATCH_ROLE',
    profile.id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'roleCode', profile.role_code,
      'managedRegions', profile.managed_regions,
      'managedZones', profile.managed_zones,
      'managedGroups', profile.managed_groups
    ),
    '在後台重新儲存管理範圍；只保留符合目前角色層級的 managed_* 欄位。'
  FROM role_by_profile AS profile
  WHERE (profile.role_code = 'great_zone_leader'
          AND (profile.managed_zones <> '' OR profile.managed_groups <> ''))
     OR (profile.role_code = 'zone_leader'
          AND (profile.managed_regions <> '' OR profile.managed_groups <> ''))
     OR (profile.role_code = 'group_leader'
          AND (profile.managed_regions <> '' OR profile.managed_zones <> ''))
     OR (profile.role_code IN ('member', 'senior_pastor', 'admin')
          AND (profile.managed_regions <> '' OR profile.managed_zones <> '' OR profile.managed_groups <> ''))

  -- -----------------------------------------------------------------------
  -- Global plans and personal enrollments
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'global_plans', 'GLOBAL_PLAN_SCALAR_INVALID',
    plan.id::TEXT, plan.name,
    JSONB_BUILD_OBJECT(
      'startDate', plan.start_date,
      'endDate', plan.end_date,
      'planKind', plan.plan_kind,
      'ruleVersion', plan.rule_version
    ),
    '修正計畫名稱、日期、plan_kind 或 rule_version。'
  FROM public.global_plans AS plan
  WHERE BTRIM(plan.name) = ''
     OR plan.end_date < plan.start_date
     OR plan.rule_version < 1
     OR plan.plan_kind NOT IN ('standard', 'church_campaign', 'church_campaign_stage')

  UNION ALL

  SELECT
    'ERROR', 'global_plans', 'JOINABLE_PLAN_WITHOUT_BOOKS',
    plan.id::TEXT, plan.name,
    JSONB_BUILD_OBJECT('planKind', plan.plan_kind, 'targetBooks', plan.target_books),
    '一般計畫與階段計畫必須至少包含一本書卷。'
  FROM public.global_plans AS plan
  WHERE plan.plan_kind IN ('standard', 'church_campaign_stage')
    AND CARDINALITY(plan.target_books) = 0

  UNION ALL

  SELECT
    'ERROR', 'global_plans', 'TARGET_BOOK_BLANK_OR_DUPLICATE',
    plan.id::TEXT, plan.name,
    JSONB_BUILD_OBJECT('targetBooks', plan.target_books),
    '移除空白或重複書卷名稱。'
  FROM public.global_plans AS plan
  WHERE EXISTS (
    SELECT 1 FROM UNNEST(plan.target_books) AS book(name) WHERE BTRIM(book.name) = ''
  )
  OR CARDINALITY(plan.target_books) <> (
    SELECT COUNT(DISTINCT BTRIM(book.name)) FROM UNNEST(plan.target_books) AS book(name)
  )

  UNION ALL

  SELECT
    'ERROR', 'global_plans', 'CAMPAIGN_PARENT_JOINABLE',
    plan.id::TEXT, plan.name,
    JSONB_BUILD_OBJECT('isHidden', plan.is_hidden, 'enrollmentCount', COUNT(enrollment.id)),
    'church_campaign 是規則容器，必須隱藏且不可有 reading_plans；使用者應加入 stage plan。'
  FROM public.global_plans AS plan
  LEFT JOIN public.reading_plans AS enrollment ON enrollment.global_plan_id = plan.id
  WHERE plan.plan_kind = 'church_campaign'
  GROUP BY plan.id
  HAVING plan.is_hidden = FALSE OR COUNT(enrollment.id) > 0

  UNION ALL

  SELECT
    'ERROR', 'global_plans', 'STAGE_RULE_PROJECTION_MISMATCH',
    plan.id::TEXT, plan.name,
    JSONB_BUILD_OBJECT(
      'ruleId', plan.rules->>'id',
      'rulePlanKind', plan.rules->>'planKind',
      'ruleStartDate', plan.rules->>'startDate',
      'ruleEndDate', plan.rules->>'endDate',
      'columnStartDate', plan.start_date,
      'columnEndDate', plan.end_date
    ),
    '重新發布教會計畫規則，使 stage JSON 與資料表欄位一致。'
  FROM public.global_plans AS plan
  WHERE plan.plan_kind = 'church_campaign_stage'
    AND (
      plan.rules->>'id' IS DISTINCT FROM plan.id::TEXT
      OR plan.rules->>'planKind' IS DISTINCT FROM 'church_campaign_stage'
      OR plan.rules->>'startDate' IS DISTINCT FROM plan.start_date::TEXT
      OR plan.rules->>'endDate' IS DISTINCT FROM plan.end_date::TEXT
      OR NULLIF(plan.rules->>'presetKey', '') IS NULL
    )

  UNION ALL

  SELECT
    'WARNING', 'global_plans', 'DUPLICATE_NORMALIZED_PLAN_NAME',
    NULL, duplicate.normalized_name,
    JSONB_BUILD_OBJECT('planIds', duplicate.plan_ids, 'names', duplicate.plan_names),
    '確認是否為重複舊計畫；不要只靠名稱合併，應依 UUID 與 plan_kind 判斷。'
  FROM (
    SELECT
      LOWER(REGEXP_REPLACE(BTRIM(plan.name), '\s+', ' ', 'g')) AS normalized_name,
      ARRAY_AGG(plan.id ORDER BY plan.created_at) AS plan_ids,
      ARRAY_AGG(plan.name ORDER BY plan.created_at) AS plan_names
    FROM public.global_plans AS plan
    GROUP BY LOWER(REGEXP_REPLACE(BTRIM(plan.name), '\s+', ' ', 'g'))
    HAVING COUNT(*) > 1
  ) AS duplicate

  UNION ALL

  SELECT
    'ERROR', 'reading_plans', 'ENROLLMENT_SCALAR_INVALID',
    enrollment.id::TEXT, enrollment.name,
    JSONB_BUILD_OBJECT(
      'userId', enrollment.user_id,
      'startDate', enrollment.start_date,
      'endDate', enrollment.end_date,
      'currentRound', enrollment.current_round,
      'readingDaysPerWeek', enrollment.reading_days_per_week,
      'restWeekdays', enrollment.rest_weekdays
    ),
    '修正個人計畫的日期、輪次或每週閱讀日設定。'
  FROM public.reading_plans AS enrollment
  WHERE BTRIM(enrollment.name) = ''
     OR enrollment.end_date < enrollment.start_date
     OR enrollment.current_round < 1
     OR enrollment.reading_days_per_week NOT BETWEEN 1 AND 7
     OR NOT (enrollment.rest_weekdays <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[])
     OR CARDINALITY(enrollment.rest_weekdays) <> 7 - enrollment.reading_days_per_week
     OR CARDINALITY(enrollment.rest_weekdays) <> (
       SELECT COUNT(DISTINCT weekday) FROM UNNEST(enrollment.rest_weekdays) AS weekday
     )

  UNION ALL

  SELECT
    'ERROR', 'reading_plans', 'FIXED_ENROLLMENT_DRIFT',
    enrollment.id::TEXT, enrollment.name,
    JSONB_BUILD_OBJECT(
      'globalPlanId', enrollment.global_plan_id,
      'globalName', plan.name,
      'enrollmentDates', JSONB_BUILD_ARRAY(enrollment.start_date, enrollment.end_date),
      'globalDates', JSONB_BUILD_ARRAY(plan.start_date, plan.end_date),
      'enrollmentBooks', enrollment.target_books,
      'globalBooks', plan.target_books
    ),
    '重新同步固定計畫；個人 enrollment 不應偏離 global plan。'
  FROM public.reading_plans AS enrollment
  JOIN public.global_plans AS plan ON plan.id = enrollment.global_plan_id
  WHERE plan.is_fixed = TRUE
    AND (
      enrollment.name IS DISTINCT FROM plan.name
      OR enrollment.start_date IS DISTINCT FROM plan.start_date
      OR enrollment.end_date IS DISTINCT FROM plan.end_date
      OR enrollment.target_books IS DISTINCT FROM plan.target_books
      OR enrollment.is_fixed IS DISTINCT FROM TRUE
    )

  UNION ALL

  SELECT
    'ERROR', 'reading_plans', 'STAGE_PRESET_KEY_MISMATCH',
    enrollment.id::TEXT, enrollment.name,
    JSONB_BUILD_OBJECT(
      'presetKey', enrollment.preset_key,
      'expectedPresetKey', plan.rules->>'presetKey',
      'globalPlanId', plan.id
    ),
    '將 enrollment.preset_key 同步為 stage rules.presetKey。'
  FROM public.reading_plans AS enrollment
  JOIN public.global_plans AS plan ON plan.id = enrollment.global_plan_id
  WHERE plan.plan_kind = 'church_campaign_stage'
    AND enrollment.preset_key IS DISTINCT FROM plan.rules->>'presetKey'

  UNION ALL

  SELECT
    'ERROR', 'reading_plans', 'LEGACY_RETIRED_PLAN_REMAINS',
    enrollment.id::TEXT, enrollment.name,
    JSONB_BUILD_OBJECT('presetKey', enrollment.preset_key, 'globalPlanId', enrollment.global_plan_id),
    '確認後移除已退役 q1-q4、church_2026_2029 或 m_* 舊計畫資料。'
  FROM public.reading_plans AS enrollment
  WHERE enrollment.global_plan_id IS NULL
    AND (
      enrollment.preset_key IN ('q1', 'q2', 'q3', 'q4', 'church_2026_2029')
      OR enrollment.preset_key LIKE 'm\_%' ESCAPE '\'
    )

  UNION ALL

  SELECT
    'ERROR', 'reading_plans', 'DUPLICATE_GLOBAL_PLAN_ENROLLMENT',
    NULL, duplicate.global_plan_id::TEXT,
    JSONB_BUILD_OBJECT(
      'userId', duplicate.user_id,
      'globalPlanId', duplicate.global_plan_id,
      'enrollmentIds', duplicate.enrollment_ids
    ),
    '同一 profile 對同一 global plan 只能有一筆 reading_plans。'
  FROM (
    SELECT
      enrollment.user_id,
      enrollment.global_plan_id,
      ARRAY_AGG(enrollment.id ORDER BY enrollment.created_at) AS enrollment_ids
    FROM public.reading_plans AS enrollment
    WHERE enrollment.global_plan_id IS NOT NULL
    GROUP BY enrollment.user_id, enrollment.global_plan_id
    HAVING COUNT(*) > 1
  ) AS duplicate

  -- -----------------------------------------------------------------------
  -- Reading logs
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'reading_logs', 'LOG_PLAN_OWNER_MISMATCH',
    log.id::TEXT, CONCAT(log.book, ' ', log.chapter),
    JSONB_BUILD_OBJECT(
      'logUserId', log.user_id,
      'planId', log.plan_id,
      'planUserId', enrollment.user_id
    ),
    '閱讀紀錄只能連到同一位使用者的 reading_plan。'
  FROM public.reading_logs AS log
  JOIN public.reading_plans AS enrollment ON enrollment.id = log.plan_id
  WHERE log.user_id IS DISTINCT FROM enrollment.user_id

  UNION ALL

  SELECT
    'ERROR', 'reading_logs', 'LOG_BOOK_OUTSIDE_PLAN',
    log.id::TEXT, CONCAT(log.book, ' ', log.chapter),
    JSONB_BUILD_OBJECT('planId', log.plan_id, 'targetBooks', enrollment.target_books),
    '確認書卷名稱是否為舊格式；不屬於該計畫的紀錄應移到正確計畫或清除。'
  FROM public.reading_logs AS log
  JOIN public.reading_plans AS enrollment ON enrollment.id = log.plan_id
  WHERE NOT (log.book = ANY(enrollment.target_books))

  UNION ALL

  SELECT
    'ERROR', 'reading_logs', 'LOG_SCALAR_INVALID',
    log.id::TEXT, CONCAT(log.book, ' ', log.chapter),
    JSONB_BUILD_OBJECT('chapter', log.chapter, 'round', log.round, 'book', log.book),
    '書卷不可空白，章與輪次必須為正整數；章數大於 150 需人工確認。'
  FROM public.reading_logs AS log
  WHERE BTRIM(log.book) = ''
     OR log.chapter < 1
     OR log.chapter > 150
     OR log.round < 1

  UNION ALL

  SELECT
    'WARNING', 'reading_logs', 'LOG_ROUND_AHEAD_OF_PLAN',
    log.id::TEXT, CONCAT(log.book, ' ', log.chapter),
    JSONB_BUILD_OBJECT('logRound', log.round, 'currentRound', enrollment.current_round, 'planId', enrollment.id),
    '確認是否先前降級留下的紀錄；若屬正常歷史可保留。'
  FROM public.reading_logs AS log
  JOIN public.reading_plans AS enrollment ON enrollment.id = log.plan_id
  WHERE log.round > enrollment.current_round

  UNION ALL

  SELECT
    'WARNING', 'reading_logs', 'LOG_OUTSIDE_PLAN_DATE_RANGE',
    log.id::TEXT, CONCAT(log.book, ' ', log.chapter),
    JSONB_BUILD_OBJECT(
      'readAt', log.read_at,
      'planStartDate', enrollment.start_date,
      'planEndDate', enrollment.end_date,
      'planId', enrollment.id
    ),
    '可能是補登或延後完成；請人工確認，不要直接刪除。'
  FROM public.reading_logs AS log
  JOIN public.reading_plans AS enrollment ON enrollment.id = log.plan_id
  WHERE log.read_at::DATE < enrollment.start_date
     OR log.read_at::DATE > enrollment.end_date

  UNION ALL

  SELECT
    'ERROR', 'reading_logs', 'DUPLICATE_READING_LOG',
    NULL, duplicate.duplicate_key,
    JSONB_BUILD_OBJECT('logIds', duplicate.log_ids, 'count', duplicate.log_count),
    '每個 user/plan/book/chapter/round 只能有一筆；保留語意正確的一筆後再移除重複。'
  FROM (
    SELECT
      CONCAT(
        log.user_id, '/',
        COALESCE(log.plan_id::TEXT, 'personal'), '/',
        log.book, '/', log.chapter, '/', log.round
      ) AS duplicate_key,
      ARRAY_AGG(log.id ORDER BY log.read_at, log.created_at) AS log_ids,
      COUNT(*) AS log_count
    FROM public.reading_logs AS log
    GROUP BY log.user_id, log.plan_id, log.book, log.chapter, log.round
    HAVING COUNT(*) > 1
  ) AS duplicate

  -- -----------------------------------------------------------------------
  -- Reading competition teams and small-home teams
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'reading_teams', 'TEAM_PLAN_KIND_INVALID',
    team.id::TEXT, team.name,
    JSONB_BUILD_OBJECT('globalPlanId', team.global_plan_id, 'planKind', plan.plan_kind),
    '競賽團隊只能建立於 church_campaign_stage。'
  FROM public.reading_teams AS team
  JOIN public.global_plans AS plan ON plan.id = team.global_plan_id
  WHERE plan.plan_kind IS DISTINCT FROM 'church_campaign_stage'

  UNION ALL

  SELECT
    'ERROR', 'reading_teams', 'TEAM_CAPTAIN_MEMBERSHIP_INVALID',
    team.id::TEXT, team.name,
    JSONB_BUILD_OBJECT(
      'captainId', team.captain_id,
      'captainRows', counts.captain_count,
      'matchingCaptainRows', counts.matching_captain_count
    ),
    '每隊必須恰有一位 captain，且 captain member 的 user_id 必須等於 reading_teams.captain_id。'
  FROM public.reading_teams AS team
  JOIN team_counts AS counts ON counts.team_id = team.id
  WHERE counts.captain_count <> 1 OR counts.matching_captain_count <> 1

  UNION ALL

  SELECT
    'ERROR', 'reading_teams', 'TEAM_CAPACITY_OR_STATUS_INVALID',
    team.id::TEXT, team.name,
    JSONB_BUILD_OBJECT(
      'division', team.division,
      'status', team.status,
      'memberCount', counts.member_count
    ),
    '成員不可超過 division；ready 必須剛好滿隊，未滿隊應為 forming。'
  FROM public.reading_teams AS team
  JOIN team_counts AS counts ON counts.team_id = team.id
  WHERE counts.member_count > team.division
     OR (team.status = 'ready' AND counts.member_count <> team.division)
     OR (team.status = 'forming' AND counts.member_count >= team.division)

  UNION ALL

  SELECT
    'ERROR', 'reading_teams', 'TEAM_MEMBER_LINK_MISMATCH',
    member.team_id::TEXT, profile.name,
    JSONB_BUILD_OBJECT(
      'memberGlobalPlanId', member.global_plan_id,
      'teamGlobalPlanId', team.global_plan_id,
      'memberDivision', member.division,
      'teamDivision', team.division,
      'userId', member.user_id
    ),
    'member 的 team_id、global_plan_id、division 必須與母隊完全一致。'
  FROM public.reading_team_members AS member
  JOIN public.reading_teams AS team ON team.id = member.team_id
  LEFT JOIN public.profiles AS profile ON profile.id = member.user_id
  WHERE member.global_plan_id IS DISTINCT FROM team.global_plan_id
     OR member.division IS DISTINCT FROM team.division

  UNION ALL

  SELECT
    'ERROR', 'reading_teams', 'DUPLICATE_TEAM_NAME',
    NULL, duplicate.normalized_name,
    JSONB_BUILD_OBJECT(
      'globalPlanId', duplicate.global_plan_id,
      'division', duplicate.division,
      'teamIds', duplicate.team_ids
    ),
    '同一計畫、同一組別的隊名經正規化後必須唯一。'
  FROM (
    SELECT
      team.global_plan_id,
      team.division,
      public.normalize_reading_team_name(team.name) AS normalized_name,
      ARRAY_AGG(team.id ORDER BY team.created_at) AS team_ids
    FROM public.reading_teams AS team
    GROUP BY team.global_plan_id, team.division, public.normalize_reading_team_name(team.name)
    HAVING COUNT(*) > 1
  ) AS duplicate

  UNION ALL

  SELECT
    'ERROR', 'small_home_teams', 'SMALL_HOME_TEAM_CAPACITY_INVALID',
    team.id::TEXT, team.name,
    JSONB_BUILD_OBJECT(
      'memberCount', counts.member_count,
      'configuredMin', COALESCE((plan.rules #>> '{rules,teamRules,smallHome,min}')::INTEGER, 2),
      'configuredMax', COALESCE((plan.rules #>> '{rules,teamRules,smallHome,max}')::INTEGER, 4),
      'isLocked', team.is_locked
    ),
    '人數不可超過規則上限；locked 團隊人數應符合規則下限。'
  FROM public.small_home_teams AS team
  JOIN small_home_team_counts AS counts ON counts.team_id = team.id
  JOIN public.global_plans AS plan ON plan.id = team.global_plan_id
  WHERE counts.member_count > COALESCE((plan.rules #>> '{rules,teamRules,smallHome,max}')::INTEGER, 4)
     OR (
       team.is_locked = TRUE
       AND counts.member_count < COALESCE((plan.rules #>> '{rules,teamRules,smallHome,min}')::INTEGER, 2)
     )

  -- -----------------------------------------------------------------------
  -- Devotional, reminders, announcements, likes, and reports
  -- -----------------------------------------------------------------------
  UNION ALL

  SELECT
    'ERROR', 'devotional', 'DEVOTIONAL_COMMENT_BLANK',
    comment.id::TEXT, NULL,
    JSONB_BUILD_OBJECT('noteId', comment.note_id, 'userId', comment.user_id),
    '移除空白留言或回復正確內容。'
  FROM public.devotional_comments AS comment
  WHERE BTRIM(comment.content) = ''

  UNION ALL

  SELECT
    'ERROR', 'care_reminders', 'CARE_REMINDER_STATE_INVALID',
    reminder.id::TEXT, reminder.plan_key,
    JSONB_BUILD_OBJECT(
      'senderId', reminder.sender_id,
      'recipientId', reminder.recipient_id,
      'status', reminder.status,
      'readAt', reminder.read_at,
      'createdAt', reminder.created_at
    ),
    '提醒不可傳給自己；unread 不應有 read_at，read/dismissed 必須有 read_at。'
  FROM public.care_reminders AS reminder
  WHERE reminder.sender_id = reminder.recipient_id
     OR (reminder.status = 'unread' AND reminder.read_at IS NOT NULL)
     OR (reminder.status IN ('read', 'dismissed') AND reminder.read_at IS NULL)
     OR reminder.read_at < reminder.created_at

  UNION ALL

  SELECT
    'ERROR', 'announcements', 'ANNOUNCEMENT_STATE_INVALID',
    announcement.id::TEXT, announcement.title,
    JSONB_BUILD_OBJECT(
      'isPublished', announcement.is_published,
      'publishedAt', announcement.published_at,
      'createdAt', announcement.created_at
    ),
    '標題與內容不可空白；已發布必須有合理的 published_at。'
  FROM public.church_announcements AS announcement
  WHERE BTRIM(announcement.title) = ''
     OR BTRIM(announcement.content) = ''
     OR (announcement.is_published = TRUE AND announcement.published_at IS NULL)
     OR announcement.published_at < announcement.created_at

  UNION ALL

  SELECT
    'ERROR', 'verse_likes', 'VERSE_LIKE_INVALID',
    like_row.source, like_row.source,
    JSONB_BUILD_OBJECT('likeCount', like_row.like_count, 'sourceLength', CHAR_LENGTH(like_row.source)),
    '來源不可空白或超過 512 字元，like_count 不可為負數。'
  FROM public.verse_likes AS like_row
  WHERE BTRIM(like_row.source) = ''
     OR CHAR_LENGTH(like_row.source) > 512
     OR like_row.like_count < 0

  UNION ALL

  SELECT
    'ERROR', 'issue_reports', 'ISSUE_REPORT_SCALAR_INVALID',
    report.id::TEXT, report.category,
    JSONB_BUILD_OBJECT(
      'descriptionLength', CHAR_LENGTH(report.description),
      'status', report.status,
      'category', report.category
    ),
    '修正回報分類、狀態或描述長度。'
  FROM public.issue_reports AS report
  WHERE report.category NOT IN ('bug', 'ui', 'data', 'other')
     OR report.status NOT IN ('pending', 'processing', 'resolved', 'ignored')
     OR CHAR_LENGTH(report.description) NOT BETWEEN 1 AND 500
),
numbered_issues AS (
  SELECT
    issue.*,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE issue.severity WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
        issue.area,
        issue.check_code,
        issue.record_label NULLS LAST,
        issue.record_id NULLS LAST
    ) AS issue_no
  FROM issues AS issue
),
result_rows AS (
  SELECT
    issue_no,
    severity,
    area,
    check_code,
    record_id,
    record_label,
    details,
    suggested_action
  FROM numbered_issues

  UNION ALL

  SELECT
    1,
    'PASS',
    'all',
    'NO_DATA_INTEGRITY_ISSUES',
    NULL,
    '所有資料符合目前可自動驗證的規則',
    '{}'::JSONB,
    '保留本次結果作為上線前稽核紀錄。'
  WHERE NOT EXISTS (SELECT 1 FROM numbered_issues)
)
SELECT
  result.issue_no,
  result.severity,
  result.area,
  result.check_code,
  result.record_id,
  result.record_label,
  result.details,
  result.suggested_action,
  COUNT(*) FILTER (WHERE result.severity IN ('ERROR', 'WARNING')) OVER () AS issue_count,
  COUNT(*) FILTER (WHERE result.severity = 'ERROR') OVER () AS error_count,
  COUNT(*) FILTER (WHERE result.severity = 'WARNING') OVER () AS warning_count
FROM result_rows AS result
ORDER BY result.issue_no;
