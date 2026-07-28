ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS member_context_synced_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.profiles.member_context_synced_at IS
  'Member Hub context was last successfully projected into this Bible app profile.';
