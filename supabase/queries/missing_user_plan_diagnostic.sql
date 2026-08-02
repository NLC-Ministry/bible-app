-- Diagnose: an administrator sees a reading_plans row, but the member cannot see it.
-- Read-only. Prefer the reading_plans.user_id shown in the admin/backend.
-- Replace target_profile_id below with that UUID. Email is only a fallback.

WITH input AS (
  SELECT
    btrim('REPLACE_WITH_READING_PLANS_USER_ID') AS target_profile_id,
    lower(btrim('OPTIONAL_MEMBER_EMAIL')) AS target_email
),
matched_profiles AS (
  SELECT DISTINCT p.*
  FROM public.profiles p
  LEFT JOIN public.user_identities identity ON identity.profile_id = p.id
  CROSS JOIN input
  WHERE p.id::text = input.target_profile_id
     OR lower(btrim(COALESCE(p.email, ''))) = input.target_email
     OR lower(btrim(COALESCE(identity.email, ''))) = input.target_email
),
profile_summary AS (
  SELECT
    profile.id AS profile_id,
    profile.name,
    profile.email AS profile_email,
    profile.is_active,
    profile.created_at AS profile_created_at,
    count(*) OVER () AS matched_profile_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'provider', identity.provider,
          'provider_user_id', identity.provider_user_id,
          'email', identity.email,
          'is_primary', identity.is_primary,
          'last_seen_at', identity.last_seen_at
        ) ORDER BY identity.last_seen_at DESC NULLS LAST
      ) FILTER (WHERE identity.id IS NOT NULL),
      '[]'::jsonb
    ) AS identities
  FROM matched_profiles profile
  LEFT JOIN public.user_identities identity ON identity.profile_id = profile.id
  GROUP BY profile.id, profile.name, profile.email, profile.is_active, profile.created_at
)
SELECT
  summary.profile_id,
  summary.name,
  summary.profile_email,
  summary.is_active,
  summary.matched_profile_count,
  summary.identities,
  plan.id AS reading_plan_id,
  plan.global_plan_id,
  plan.preset_key,
  plan.name AS reading_plan_name,
  plan.start_date,
  plan.end_date,
  plan.created_at AS enrollment_created_at,
  global_plan.name AS global_plan_name,
  global_plan.plan_kind,
  global_plan.is_hidden AS global_plan_is_hidden,
  CASE
    WHEN summary.matched_profile_count > 1
      THEN 'DUPLICATE_PROFILE: current login may point to a different profile_id'
    WHEN plan.id IS NULL
      THEN 'NO_PLAN_ON_PROFILE: the plan is attached to another profile_id or was removed'
    WHEN global_plan.id IS NULL AND plan.global_plan_id IS NOT NULL
      THEN 'MISSING_GLOBAL_PLAN: enrollment references a missing global plan'
    WHEN global_plan.is_hidden IS TRUE
      THEN 'HIDDEN_GLOBAL_PLAN: normal members are intentionally prevented from seeing it'
    WHEN plan.end_date < current_date
      THEN 'EXPIRED: shown under completed plans instead of ongoing plans'
    WHEN plan.start_date IS NULL OR plan.end_date IS NULL OR plan.target_books IS NULL
      THEN 'INVALID_PLAN_DATA: required plan fields are incomplete'
    ELSE 'VISIBLE_DATA_OK: inspect the nlc-data response or client runtime error'
  END AS diagnosis
FROM profile_summary summary
LEFT JOIN public.reading_plans plan ON plan.user_id = summary.profile_id
LEFT JOIN public.global_plans global_plan ON global_plan.id = plan.global_plan_id
ORDER BY summary.profile_created_at, plan.created_at DESC NULLS LAST;

