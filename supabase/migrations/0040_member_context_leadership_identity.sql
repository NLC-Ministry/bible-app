ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS member_context_leadership_display_label TEXT,
  ADD COLUMN IF NOT EXISTS member_context_leadership_primary_assignment_id TEXT,
  ADD COLUMN IF NOT EXISTS member_context_leadership_assignments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.member_context_leadership_display_label IS
  'Display-only primary leadership label synchronized from Member Hub /api/me/context.';

COMMENT ON COLUMN public.profiles.member_context_leadership_primary_assignment_id IS
  'Display-only primary Member Hub node_role_assignments identifier synchronized from Member Hub.';

COMMENT ON COLUMN public.profiles.member_context_leadership_assignments IS
  'Display-only Member Hub leadership identity assignments projection. Not used for Bible app authorization.';
