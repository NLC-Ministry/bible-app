-- Calls the issue-report-sheet-sync Edge Function directly from Postgres on
-- every new issue_reports row, using pg_net — bypassing the Dashboard's
-- Database Webhooks UI, which wasn't reachable in this project
-- (Database > Triggers only offers Postgres functions, and
-- /database/hooks 404s). This reproduces the same HTTP call a Database
-- Webhook would have made, using the exact payload shape
-- (type/table/record) the Edge Function already expects.
--
-- One-time manual step required (NOT done by this migration, since it must
-- not put a real secret in a file committed to git): run this once in the
-- Supabase SQL Editor, replacing the placeholder with the same random
-- string you set as the ISSUE_REPORT_WEBHOOK_SECRET Edge Function secret:
--
--   select vault.create_secret(
--     'REPLACE_WITH_YOUR_ISSUE_REPORT_WEBHOOK_SECRET',
--     'issue_report_webhook_secret',
--     'x-webhook-secret sent to issue-report-sheet-sync'
--   );
--
-- If it's ever rotated later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'issue_report_webhook_secret'),
--     'NEW_SECRET_VALUE'
--   );

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_issue_report_sheet_sync()
RETURNS TRIGGER AS $$
DECLARE
  webhook_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'issue_report_webhook_secret'
  LIMIT 1;

  -- Don't block the insert if the secret hasn't been configured yet (e.g.
  -- during initial setup) — just skip the sync silently and log it.
  IF webhook_secret IS NULL THEN
    RAISE WARNING 'issue_report_webhook_secret not found in Vault; skipping sheet sync for issue_reports row %', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://ztozevcqkfrohgjmngcj.supabase.co/functions/v1/issue-report-sheet-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    -- Same shape as a Supabase Database Webhook payload, matching what
    -- supabase/functions/issue-report-sheet-sync/index.ts already parses.
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'issue_reports',
      'schema', 'public',
      'record', row_to_json(NEW)
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trigger_issue_report_sheet_sync ON public.issue_reports;

CREATE TRIGGER trigger_issue_report_sheet_sync
  AFTER INSERT ON public.issue_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_issue_report_sheet_sync();
