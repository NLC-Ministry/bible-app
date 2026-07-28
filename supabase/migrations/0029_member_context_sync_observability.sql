ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS member_context_sync_attempted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS member_context_sync_status TEXT,
  ADD COLUMN IF NOT EXISTS member_context_sync_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'member_context_sync_status_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT member_context_sync_status_check
      CHECK (
        member_context_sync_status IS NULL
        OR member_context_sync_status IN ('success', 'failed', 'degraded')
      );
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.member_context_sync_attempted_at IS
  'Member Hub context sync was last attempted by the Bible app integration.';

COMMENT ON COLUMN public.profiles.member_context_sync_status IS
  'Latest Member Hub context sync outcome: success, degraded, or failed.';

COMMENT ON COLUMN public.profiles.member_context_sync_error IS
  'Safe diagnostic summary for the latest Member Hub context sync failure.';
