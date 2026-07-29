-- Ensure Edge Functions using the Supabase service-role client can maintain
-- Hub-owned account, identity, and organization projections.

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_identities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.great_regions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pastoral_zones TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.small_groups TO service_role;
