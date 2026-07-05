-- Member Hub external member reference for cross-system alignment
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nlc_member_id UUID UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_nlc_member_id
  ON public.profiles(nlc_member_id)
  WHERE nlc_member_id IS NOT NULL;
