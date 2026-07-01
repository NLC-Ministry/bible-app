-- ============================================================
-- Clean baseline schema for New Life Bible Reading
-- Apply this to a fresh Supabase project.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Shared helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$;

-- ============================================================
-- Church organization
-- ============================================================

CREATE TABLE public.great_regions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE public.pastoral_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  great_region_id UUID REFERENCES public.great_regions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(name, great_region_id)
);

CREATE TABLE public.small_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pastoral_zone_id UUID REFERENCES public.pastoral_zones(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(name, pastoral_zone_id)
);

-- ============================================================
-- Stable app users and login identities
-- ============================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  great_region_id UUID REFERENCES public.great_regions(id) ON DELETE SET NULL,
  pastoral_zone_id UUID REFERENCES public.pastoral_zones(id) ON DELETE SET NULL,
  small_group_id UUID REFERENCES public.small_groups(id) ON DELETE SET NULL,
  great_region TEXT NOT NULL DEFAULT '',
  pastoral_zone TEXT NOT NULL DEFAULT '',
  small_group TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT profiles_role_check CHECK (role IN ('member', 'group_leader', 'zone_leader', 'great_zone_leader', 'admin', 'senior_pastor'))
);

CREATE TABLE public.user_identities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT user_identities_provider_check CHECK (provider IN ('supabase', 'google', 'logto', 'nlc', 'email', 'manual')),
  CONSTRAINT user_identities_provider_subject_unique UNIQUE (provider, provider_user_id)
);

CREATE UNIQUE INDEX idx_user_identities_one_primary_per_profile
  ON public.user_identities(profile_id)
  WHERE is_primary;
CREATE INDEX idx_user_identities_profile_id ON public.user_identities(profile_id);
CREATE INDEX idx_user_identities_email ON public.user_identities(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_zone_group ON public.profiles(pastoral_zone, small_group);

-- Create a stable profile automatically for Supabase Auth users.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  display_name TEXT;
  provider_name TEXT;
BEGIN
  display_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    NEW.email,
    'New User'
  );

  provider_name := COALESCE(NEW.app_metadata ->> 'provider', 'supabase');

  INSERT INTO public.profiles (id, auth_user_id, name, email)
  VALUES (NEW.id, NEW.id, display_name, NEW.email)
  ON CONFLICT (id) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    updated_at = TIMEZONE('utc'::text, NOW());

  INSERT INTO public.user_identities (
    profile_id,
    provider,
    provider_user_id,
    email,
    display_name,
    is_primary,
    metadata,
    last_seen_at
  ) VALUES (
    NEW.id,
    CASE WHEN provider_name = 'google' THEN 'google' ELSE 'supabase' END,
    NEW.id::text,
    NEW.email,
    display_name,
    TRUE,
    jsonb_build_object('auth_provider', provider_name),
    NOW()
  ) ON CONFLICT (provider, provider_user_id) DO UPDATE SET
    profile_id = EXCLUDED.profile_id,
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    last_seen_at = NOW(),
    updated_at = TIMEZONE('utc'::text, NOW());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT p.id
      FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1
    ),
    (
      SELECT ui.profile_id
      FROM public.user_identities ui
      WHERE ui.provider_user_id = (auth.jwt() ->> 'sub')
      ORDER BY ui.is_primary DESC, ui.created_at ASC
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE(
  my_role TEXT,
  my_great_region TEXT,
  my_pastoral_zone TEXT,
  my_small_group TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role, great_region, pastoral_zone, small_group
  FROM public.profiles
  WHERE id = public.current_profile_id();
$$;

-- ============================================================
-- Global reading plans and personal enrollments
-- ============================================================

CREATE TABLE public.global_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_books TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  cover_image_url TEXT,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE TABLE public.reading_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  global_plan_id UUID REFERENCES public.global_plans(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_books TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  preset_key TEXT,
  level TEXT NOT NULL DEFAULT 'normal',
  current_round INTEGER NOT NULL DEFAULT 1,
  was_downgraded BOOLEAN NOT NULL DEFAULT FALSE,
  downgrade_locked_until TIMESTAMP WITH TIME ZONE,
  upgrade_prompt_handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT reading_plans_level_check CHECK (level IN ('normal', 'breakthrough', 'super'))
);

CREATE UNIQUE INDEX idx_reading_plans_one_global_plan_per_user
  ON public.reading_plans(user_id, global_plan_id)
  WHERE global_plan_id IS NOT NULL;
CREATE INDEX idx_reading_plans_user_id ON public.reading_plans(user_id);
CREATE INDEX idx_reading_plans_global_plan_id ON public.reading_plans(global_plan_id);
CREATE INDEX idx_reading_plans_preset_key ON public.reading_plans(preset_key);

CREATE TABLE public.reading_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.reading_plans(id) ON DELETE CASCADE,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  read_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT reading_logs_chapter_check CHECK (chapter > 0),
  CONSTRAINT reading_logs_round_check CHECK (round > 0),
  CONSTRAINT reading_logs_unique UNIQUE (user_id, plan_id, book, chapter, round)
);

CREATE INDEX idx_reading_logs_user_id ON public.reading_logs(user_id);
CREATE INDEX idx_reading_logs_plan_id ON public.reading_logs(plan_id);
CREATE INDEX idx_reading_logs_read_at ON public.reading_logs(read_at DESC);

CREATE TABLE public.devotional_notes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  note_date DATE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(user_id, note_date)
);

CREATE INDEX idx_devotional_notes_user_date ON public.devotional_notes(user_id, note_date DESC);

CREATE TABLE public.church_announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX idx_church_announcements_published ON public.church_announcements(is_published, published_at DESC);

-- ============================================================
-- Views for dashboards and admin inspection
-- ============================================================

CREATE VIEW public.profile_identity_overview AS
SELECT
  p.id AS profile_id,
  p.name,
  p.email,
  p.role,
  p.pastoral_zone,
  p.small_group,
  ui.provider,
  ui.provider_user_id,
  ui.email AS identity_email,
  ui.is_primary,
  ui.last_seen_at,
  p.created_at AS profile_created_at
FROM public.profiles p
LEFT JOIN public.user_identities ui ON ui.profile_id = p.id;

CREATE VIEW public.member_reading_summary AS
SELECT
  p.id AS user_id,
  p.name,
  p.role,
  p.great_region,
  p.pastoral_zone,
  p.small_group,
  COUNT(DISTINCT rp.id) AS plan_count,
  COUNT(rl.id) AS log_count,
  MAX(rl.read_at) AS last_read_at
FROM public.profiles p
LEFT JOIN public.reading_plans rp ON rp.user_id = p.id
LEFT JOIN public.reading_logs rl ON rl.user_id = p.id
WHERE p.is_demo = FALSE
GROUP BY p.id, p.name, p.role, p.great_region, p.pastoral_zone, p.small_group;

-- ============================================================
-- Triggers
-- ============================================================

CREATE TRIGGER trg_great_regions_updated_at BEFORE UPDATE ON public.great_regions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pastoral_zones_updated_at BEFORE UPDATE ON public.pastoral_zones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_small_groups_updated_at BEFORE UPDATE ON public.small_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_user_identities_updated_at BEFORE UPDATE ON public.user_identities FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_global_plans_updated_at BEFORE UPDATE ON public.global_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_reading_plans_updated_at BEFORE UPDATE ON public.reading_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_reading_logs_updated_at BEFORE UPDATE ON public.reading_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_devotional_notes_updated_at BEFORE UPDATE ON public.devotional_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_church_announcements_updated_at BEFORE UPDATE ON public.church_announcements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.great_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pastoral_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.small_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reading_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devotional_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_read_authenticated ON public.great_regions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY org_manage_admin ON public.great_regions FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

CREATE POLICY zones_read_authenticated ON public.pastoral_zones FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY zones_manage_admin ON public.pastoral_zones FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

CREATE POLICY groups_read_authenticated ON public.small_groups FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY groups_manage_admin ON public.small_groups FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

CREATE POLICY profiles_manage_own ON public.profiles FOR ALL TO authenticated USING (id = public.current_profile_id()) WITH CHECK (id = public.current_profile_id());
CREATE POLICY profiles_manage_admin ON public.profiles FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));
CREATE POLICY profiles_select_by_scope ON public.profiles FOR SELECT TO authenticated USING (
  id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR ((SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ',')))
  OR ((SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')))
  OR ((SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ',')))
);

CREATE POLICY identities_select_own_or_admin ON public.user_identities FOR SELECT TO authenticated USING (profile_id = public.current_profile_id() OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));
CREATE POLICY identities_manage_admin ON public.user_identities FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

CREATE POLICY global_plans_read_visible ON public.global_plans FOR SELECT TO authenticated USING (is_hidden = FALSE OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));
CREATE POLICY global_plans_manage_admin ON public.global_plans FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

CREATE POLICY reading_plans_manage_own ON public.reading_plans FOR ALL TO authenticated USING (user_id = public.current_profile_id()) WITH CHECK (user_id = public.current_profile_id());
CREATE POLICY reading_plans_select_by_scope ON public.reading_plans FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_id AND (
      (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND p.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
      OR (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
      OR (SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND p.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
    )
  )
);

CREATE POLICY reading_logs_manage_own ON public.reading_logs FOR ALL TO authenticated USING (user_id = public.current_profile_id()) WITH CHECK (user_id = public.current_profile_id());
CREATE POLICY reading_logs_select_by_scope ON public.reading_logs FOR SELECT TO authenticated USING (
  user_id = public.current_profile_id()
  OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = user_id AND (
      (SELECT my_role FROM public.get_my_profile()) = 'great_zone_leader' AND p.great_region = ANY(string_to_array((SELECT my_great_region FROM public.get_my_profile()), ','))
      OR (SELECT my_role FROM public.get_my_profile()) = 'zone_leader' AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ','))
      OR (SELECT my_role FROM public.get_my_profile()) IN ('group_leader', 'member') AND p.pastoral_zone = ANY(string_to_array((SELECT my_pastoral_zone FROM public.get_my_profile()), ',')) AND p.small_group = ANY(string_to_array((SELECT my_small_group FROM public.get_my_profile()), ','))
    )
  )
);

CREATE POLICY devotional_notes_manage_own ON public.devotional_notes FOR ALL TO authenticated USING (user_id = public.current_profile_id()) WITH CHECK (user_id = public.current_profile_id());

CREATE POLICY announcements_read_published ON public.church_announcements FOR SELECT TO authenticated USING (is_published = TRUE OR (SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));
CREATE POLICY announcements_manage_admin ON public.church_announcements FOR ALL TO authenticated USING ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor')) WITH CHECK ((SELECT my_role FROM public.get_my_profile()) IN ('admin', 'senior_pastor'));

-- ============================================================
-- Grants for views
-- ============================================================

GRANT SELECT ON public.profile_identity_overview TO authenticated;
GRANT SELECT ON public.member_reading_summary TO authenticated;

﻿-- Grants required for RLS policies to take effect for browser clients.
-- RLS policies decide which rows are visible/editable; GRANT decides whether
-- the role may access the table at all.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.current_profile_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- Public reference data used by profile selectors and plan browsing.
GRANT SELECT ON public.great_regions TO authenticated;
GRANT SELECT ON public.pastoral_zones TO authenticated;
GRANT SELECT ON public.small_groups TO authenticated;
GRANT SELECT ON public.global_plans TO authenticated;
GRANT SELECT ON public.church_announcements TO authenticated;

-- User-owned data. RLS policies still restrict each user to their allowed rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_identities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devotional_notes TO authenticated;

-- Admin-managed shared data. RLS policies still restrict writes to admin roles.
GRANT INSERT, UPDATE, DELETE ON public.great_regions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pastoral_zones TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.small_groups TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.global_plans TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.church_announcements TO authenticated;

GRANT SELECT ON public.profile_identity_overview TO authenticated;
GRANT SELECT ON public.member_reading_summary TO authenticated;

