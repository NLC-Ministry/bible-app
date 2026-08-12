-- Daily quiz remains disabled until an administrator explicitly opens it.
-- Existing quizzes, publications, notifications, and attempts are preserved.

INSERT INTO public.app_feature_settings (key, enabled, description)
VALUES (
  'daily_quiz',
  FALSE,
  'Controls daily quiz generation, management, publishing, and member access.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.invoke_daily_church_quiz_generation()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $invoke_daily_church_quiz_generation$
DECLARE
  cron_secret TEXT;
BEGIN
  IF NOT public.is_feature_enabled('daily_quiz') THEN
    RAISE LOG 'Daily quiz feature is disabled; skipping scheduled generation';
    RETURN;
  END IF;

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

REVOKE ALL ON FUNCTION public.invoke_daily_church_quiz_generation() FROM PUBLIC;

COMMENT ON FUNCTION public.invoke_daily_church_quiz_generation() IS
  'Invokes daily quiz generation only while the daily_quiz feature flag is enabled.';
