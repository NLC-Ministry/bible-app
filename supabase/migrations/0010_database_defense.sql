-- ============================================================
-- Database defense-in-depth and concurrency hardening
-- ============================================================
-- This migration deliberately validates existing rows. If a VALIDATE step
-- fails, inspect and repair the reported dirty rows instead of weakening the
-- constraint. Constraints are added NOT VALID first so the failing rule is
-- visible and can be diagnosed by name.

-- ------------------------------------------------------------
-- Scalar boundaries, non-empty business keys, and date ordering
-- ------------------------------------------------------------

ALTER TABLE public.great_regions
  ADD CONSTRAINT great_regions_sort_order_nonnegative CHECK (sort_order >= 0) NOT VALID,
  ADD CONSTRAINT great_regions_name_nonblank CHECK (btrim(name) <> '') NOT VALID;
ALTER TABLE public.great_regions VALIDATE CONSTRAINT great_regions_sort_order_nonnegative;
ALTER TABLE public.great_regions VALIDATE CONSTRAINT great_regions_name_nonblank;

ALTER TABLE public.pastoral_zones
  ADD CONSTRAINT pastoral_zones_sort_order_nonnegative CHECK (sort_order >= 0) NOT VALID,
  ADD CONSTRAINT pastoral_zones_name_nonblank CHECK (btrim(name) <> '') NOT VALID;
ALTER TABLE public.pastoral_zones VALIDATE CONSTRAINT pastoral_zones_sort_order_nonnegative;
ALTER TABLE public.pastoral_zones VALIDATE CONSTRAINT pastoral_zones_name_nonblank;

ALTER TABLE public.small_groups
  ADD CONSTRAINT small_groups_sort_order_nonnegative CHECK (sort_order >= 0) NOT VALID,
  ADD CONSTRAINT small_groups_name_nonblank CHECK (btrim(name) <> '') NOT VALID;
ALTER TABLE public.small_groups VALIDATE CONSTRAINT small_groups_sort_order_nonnegative;
ALTER TABLE public.small_groups VALIDATE CONSTRAINT small_groups_name_nonblank;

ALTER TABLE public.global_plans
  ADD CONSTRAINT global_plans_name_nonblank CHECK (btrim(name) <> '') NOT VALID,
  ADD CONSTRAINT global_plans_date_order CHECK (end_date >= start_date) NOT VALID;
ALTER TABLE public.global_plans VALIDATE CONSTRAINT global_plans_name_nonblank;
ALTER TABLE public.global_plans VALIDATE CONSTRAINT global_plans_date_order;

ALTER TABLE public.reading_plans
  ADD CONSTRAINT reading_plans_name_nonblank CHECK (btrim(name) <> '') NOT VALID,
  ADD CONSTRAINT reading_plans_date_order CHECK (end_date >= start_date) NOT VALID,
  ADD CONSTRAINT reading_plans_current_round_positive CHECK (current_round >= 1) NOT VALID,
  ADD CONSTRAINT reading_plans_downgrade_lock_consistency CHECK (was_downgraded OR downgrade_locked_until IS NULL) NOT VALID;
ALTER TABLE public.reading_plans VALIDATE CONSTRAINT reading_plans_name_nonblank;
ALTER TABLE public.reading_plans VALIDATE CONSTRAINT reading_plans_date_order;
ALTER TABLE public.reading_plans VALIDATE CONSTRAINT reading_plans_current_round_positive;
ALTER TABLE public.reading_plans VALIDATE CONSTRAINT reading_plans_downgrade_lock_consistency;

ALTER TABLE public.reading_logs
  ADD CONSTRAINT reading_logs_book_nonblank CHECK (btrim(book) <> '') NOT VALID;
ALTER TABLE public.reading_logs VALIDATE CONSTRAINT reading_logs_book_nonblank;

ALTER TABLE public.devotional_comments
  ADD CONSTRAINT devotional_comments_content_nonblank CHECK (btrim(content) <> '') NOT VALID;
ALTER TABLE public.devotional_comments VALIDATE CONSTRAINT devotional_comments_content_nonblank;

ALTER TABLE public.church_announcements
  ADD CONSTRAINT church_announcements_title_nonblank CHECK (btrim(title) <> '') NOT VALID,
  ADD CONSTRAINT church_announcements_content_nonblank CHECK (btrim(content) <> '') NOT VALID,
  ADD CONSTRAINT church_announcements_publish_consistency CHECK (NOT is_published OR published_at IS NOT NULL) NOT VALID,
  ADD CONSTRAINT church_announcements_publish_time_order CHECK (published_at IS NULL OR published_at >= created_at) NOT VALID;
ALTER TABLE public.church_announcements VALIDATE CONSTRAINT church_announcements_title_nonblank;
ALTER TABLE public.church_announcements VALIDATE CONSTRAINT church_announcements_content_nonblank;
ALTER TABLE public.church_announcements VALIDATE CONSTRAINT church_announcements_publish_consistency;
ALTER TABLE public.church_announcements VALIDATE CONSTRAINT church_announcements_publish_time_order;

ALTER TABLE public.care_reminders
  ADD CONSTRAINT care_reminders_read_time_order CHECK (read_at IS NULL OR read_at >= created_at) NOT VALID;
ALTER TABLE public.care_reminders VALIDATE CONSTRAINT care_reminders_read_time_order;

ALTER TABLE public.verse_likes
  ADD CONSTRAINT verse_likes_count_nonnegative CHECK (like_count >= 0) NOT VALID,
  ADD CONSTRAINT verse_likes_source_nonblank CHECK (btrim(source) <> '') NOT VALID,
  ADD CONSTRAINT verse_likes_source_length CHECK (char_length(source) <= 512) NOT VALID;
ALTER TABLE public.verse_likes VALIDATE CONSTRAINT verse_likes_count_nonnegative;
ALTER TABLE public.verse_likes VALIDATE CONSTRAINT verse_likes_source_nonblank;
ALTER TABLE public.verse_likes VALIDATE CONSTRAINT verse_likes_source_length;

-- ------------------------------------------------------------
-- Nullable unique-key hole: NULL plan_id values do not conflict in a normal
-- UNIQUE constraint. A personal reading log must still be unique per round.
-- Keep the newest semantic record if historical duplicates already exist.
-- ------------------------------------------------------------

WITH ranked_personal_logs AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, book, chapter, round
           ORDER BY read_at DESC, updated_at DESC, created_at DESC, id DESC
         ) AS duplicate_rank
  FROM public.reading_logs
  WHERE plan_id IS NULL
)
DELETE FROM public.reading_logs target
USING ranked_personal_logs ranked
WHERE target.id = ranked.id
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_logs_unique_personal
  ON public.reading_logs(user_id, book, chapter, round)
  WHERE plan_id IS NULL;

-- ------------------------------------------------------------
-- Cross-row ownership: a log may only point to a plan owned by the same user.
-- Fail deployment with a precise count if historical rows are already corrupt.
-- ------------------------------------------------------------

DO $$
DECLARE
  mismatch_count BIGINT;
BEGIN
  SELECT count(*)
  INTO mismatch_count
  FROM public.reading_logs rl
  JOIN public.reading_plans rp ON rp.id = rl.plan_id
  WHERE rl.plan_id IS NOT NULL
    AND rl.user_id IS DISTINCT FROM rp.user_id;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION 'database defense audit failed: % reading_logs rows reference another user''s plan', mismatch_count;
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_reading_log_plan_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  owner_id UUID;
BEGIN
  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT rp.user_id
  INTO owner_id
  FROM public.reading_plans rp
  WHERE rp.id = NEW.plan_id
  FOR KEY SHARE;

  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'reading log references a missing plan: %', NEW.plan_id
      USING ERRCODE = '23503';
  END IF;

  IF owner_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'reading log user % does not own plan %', NEW.user_id, NEW.plan_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reading_logs_plan_owner ON public.reading_logs;
CREATE TRIGGER trg_reading_logs_plan_owner
  BEFORE INSERT OR UPDATE OF user_id, plan_id
  ON public.reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_log_plan_owner();

-- ------------------------------------------------------------
-- Progress state machine: current_round cannot silently move backwards.
-- A lower round is only legal as an explicit automatic downgrade to a lower
-- level with a downgrade lock. This prevents stale clients overwriting progress.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_reading_plan_progress_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_level_rank INTEGER;
  new_level_rank INTEGER;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'reading plan ownership is immutable'
      USING ERRCODE = '23514';
  END IF;

  old_level_rank := CASE OLD.level WHEN 'normal' THEN 1 WHEN 'breakthrough' THEN 2 WHEN 'super' THEN 3 END;
  new_level_rank := CASE NEW.level WHEN 'normal' THEN 1 WHEN 'breakthrough' THEN 2 WHEN 'super' THEN 3 END;

  IF new_level_rank < old_level_rank
     AND NOT (NEW.was_downgraded = TRUE AND NEW.downgrade_locked_until IS NOT NULL) THEN
    RAISE EXCEPTION 'reading plan level cannot decrease without an explicit downgrade lock'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.current_round < OLD.current_round
     AND NOT (
       NEW.was_downgraded = TRUE
       AND NEW.downgrade_locked_until IS NOT NULL
       AND new_level_rank < old_level_rank
     ) THEN
    RAISE EXCEPTION 'current_round cannot decrease from % to % without an explicit downgrade', OLD.current_round, NEW.current_round
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reading_plans_progress_transition ON public.reading_plans;
CREATE TRIGGER trg_reading_plans_progress_transition
  BEFORE UPDATE OF user_id, level, current_round, was_downgraded, downgrade_locked_until
  ON public.reading_plans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_plan_progress_transition();

-- ------------------------------------------------------------
-- Profile privilege boundary. Direct authenticated clients may edit profile
-- presentation/organization fields, but cannot promote or reactivate themselves.
-- Service-role integrations remain possible and must enforce their own allowlist.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID;
  actor_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT p.id, p.role
  INTO actor_id, actor_role
  FROM public.profiles p
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;

  IF actor_role IN ('admin', 'senior_pastor') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'member'
       OR NEW.is_demo <> FALSE
       OR NEW.is_active <> TRUE
       OR NEW.nlc_member_id IS NOT NULL
       OR (NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id IS DISTINCT FROM auth.uid()) THEN
      RAISE EXCEPTION 'privileged profile fields cannot be supplied by a member'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_demo IS DISTINCT FROM OLD.is_demo
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.nlc_member_id IS DISTINCT FROM OLD.nlc_member_id THEN
      RAISE EXCEPTION 'privileged profile fields can only be changed by an administrator'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_protect_privileged_fields ON public.profiles;
CREATE TRIGGER trg_profiles_protect_privileged_fields
  BEFORE INSERT OR UPDATE
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- Members may update their row, but may not delete it. Admin policies remain.
DROP POLICY IF EXISTS profiles_manage_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = public.current_profile_id())
  WITH CHECK (id = public.current_profile_id());

-- ------------------------------------------------------------
-- Care reminder state machine and immutable audit fields.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_care_reminder_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.global_plan_id IS DISTINCT FROM OLD.global_plan_id
     OR NEW.plan_key IS DISTINCT FROM OLD.plan_key
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.sent_on IS DISTINCT FROM OLD.sent_on
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'care reminder audit fields are immutable'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('read', 'dismissed') AND NEW.status = 'unread' THEN
    RAISE EXCEPTION 'care reminder cannot transition back to unread'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('read', 'dismissed') THEN
    IF OLD.status IN ('read', 'dismissed') THEN
      NEW.read_at := OLD.read_at;
    ELSE
      NEW.read_at := COALESCE(NEW.read_at, TIMEZONE('utc'::text, NOW()));
    END IF;
  ELSE
    NEW.read_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_care_reminders_transition ON public.care_reminders;
CREATE TRIGGER trg_care_reminders_transition
  BEFORE UPDATE ON public.care_reminders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_care_reminder_transition();

-- Keep publication timestamps coherent even when clients omit published_at.
CREATE OR REPLACE FUNCTION public.enforce_announcement_publish_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.is_published AND NEW.published_at IS NULL THEN
    NEW.published_at := TIMEZONE('utc'::text, NOW());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_church_announcements_publish_state ON public.church_announcements;
CREATE TRIGGER trg_church_announcements_publish_state
  BEFORE INSERT OR UPDATE OF is_published, published_at
  ON public.church_announcements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_announcement_publish_state();

-- ------------------------------------------------------------
-- Atomic like counters. The table is read-only to browser roles; every mutation
-- must use these SECURITY DEFINER functions, eliminating lost-update races and
-- arbitrary counter replacement.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Allow public write access" ON public.verse_likes;
REVOKE INSERT, UPDATE, DELETE ON public.verse_likes FROM anon, authenticated;
GRANT SELECT ON public.verse_likes TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.increment_likes(verse_source TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_source TEXT := btrim(verse_source);
  new_count BIGINT;
BEGIN
  IF normalized_source IS NULL OR normalized_source = '' OR char_length(normalized_source) > 512 THEN
    RAISE EXCEPTION 'invalid verse source'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verse_likes (source, like_count)
  VALUES (normalized_source, 1)
  ON CONFLICT (source)
  DO UPDATE SET like_count = public.verse_likes.like_count + 1
  RETURNING like_count INTO new_count;

  RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.decrement_likes(verse_source TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_source TEXT := btrim(verse_source);
  new_count BIGINT;
BEGIN
  IF normalized_source IS NULL OR normalized_source = '' OR char_length(normalized_source) > 512 THEN
    RAISE EXCEPTION 'invalid verse source'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.verse_likes (source, like_count)
  VALUES (normalized_source, 0)
  ON CONFLICT (source)
  DO UPDATE SET like_count = GREATEST(0, public.verse_likes.like_count - 1)
  RETURNING like_count INTO new_count;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_likes(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrement_likes(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_likes(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_likes(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.increment_likes(TEXT) IS
  'Atomically increments a guarded verse counter. Direct table writes are forbidden.';
COMMENT ON FUNCTION public.decrement_likes(TEXT) IS
  'Atomically decrements a guarded verse counter without allowing negative values.';