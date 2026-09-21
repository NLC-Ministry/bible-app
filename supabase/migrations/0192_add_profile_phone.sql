-- 0192_add_profile_phone.sql
--
-- Adds profiles.phone so the standard OIDC `phone` scope's phone_number claim
-- (the Logto account's own phone identity, not Member Hub's separate
-- member:read.contact contact info) can be synced by nlc-session and shown
-- in the app's profile view. Row-level RLS already covers the whole
-- profiles row (profiles_manage_own / profiles_select_by_scope from
-- 0001_clean_schema.sql), so no new policy is needed for this column.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
