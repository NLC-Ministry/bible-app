-- Grants required for RLS policies to take effect for browser clients.
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
