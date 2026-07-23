-- Creates one unread reminder for the real account that joined TEST3TEAM or
-- TEST6TEAM. Run after seed_reading_team_test_data.sql and migration 0023.
-- This script is intentionally limited to the isolated team fixtures.

WITH reminder_target AS (
  SELECT
    team.id AS team_id,
    team.global_plan_id,
    team.captain_id AS sender_id,
    membership.user_id AS recipient_id
  FROM public.reading_teams team
  JOIN public.reading_team_members membership
    ON membership.team_id = team.id
  JOIN public.profiles recipient
    ON recipient.id = membership.user_id
  WHERE team.invite_code IN ('TEST3TEAM', 'TEST6TEAM')
    AND recipient.is_demo = FALSE
    AND membership.user_id <> team.captain_id
  ORDER BY CASE team.invite_code WHEN 'TEST3TEAM' THEN 0 ELSE 1 END
  LIMIT 1
)
INSERT INTO public.care_reminders(
  sender_id, recipient_id, global_plan_id, plan_key,
  reason, message, status, sent_on, read_at
)
SELECT
  sender_id,
  recipient_id,
  global_plan_id,
  'reading-team:' || team_id::TEXT,
  'encouragement',
  '[團隊提醒測試] 一起穩定完成今天的讀經進度，加油！',
  'unread',
  CURRENT_DATE,
  NULL
FROM reminder_target
ON CONFLICT (sender_id, recipient_id, plan_key, sent_on)
DO UPDATE SET
  reason = EXCLUDED.reason,
  message = EXCLUDED.message,
  status = 'unread',
  read_at = NULL,
  updated_at = TIMEZONE('utc'::TEXT, NOW())
RETURNING id, sender_id, recipient_id, plan_key, status, message;
