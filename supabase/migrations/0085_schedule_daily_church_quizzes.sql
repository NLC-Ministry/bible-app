-- Run the daily quiz generator at 00:05 Asia/Taipei (16:05 UTC).
-- The shared secret is intentionally not committed. Configure it once:
--
--   select vault.create_secret(
--     'REPLACE_WITH_QUIZ_GENERATION_CRON_SECRET',
--     'quiz_generation_cron_secret',
--     'x-cron-secret sent to generate-daily-quizzes'
--   );
--
-- Set the identical value as the Edge Function secret
-- QUIZ_GENERATION_CRON_SECRET.

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.invoke_daily_church_quiz_generation()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_daily_church_quiz_generation$
DECLARE
  cron_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'quiz_generation_cron_secret'
  LIMIT 1;

  IF cron_secret IS NULL THEN
    RAISE WARNING 'quiz_generation_cron_secret not found in Vault; skipping daily quiz generation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/generate-daily-quizzes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', cron_secret
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
END;
$invoke_daily_church_quiz_generation$;

DO $schedule_daily_quiz$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'generate-daily-church-quizzes'
  LIMIT 1;
  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
  PERFORM cron.schedule(
    'generate-daily-church-quizzes',
    '5 16 * * *',
    'SELECT public.invoke_daily_church_quiz_generation();'
  );
END;
$schedule_daily_quiz$;

REVOKE ALL ON FUNCTION public.invoke_daily_church_quiz_generation() FROM PUBLIC;
