DELETE FROM public.care_reminders
WHERE message LIKE '[團隊提醒測試]%'
  AND plan_key LIKE 'reading-team:%';
