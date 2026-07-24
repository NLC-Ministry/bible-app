ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_required_placement BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.profiles.has_required_placement IS
  'Member Hub authoritative membership placement readiness. Independent from actual home placement.';
