-- #676 批次提醒未報名者：一次 RPC 送一批，不再一人一次。
--
-- 舊做法是前端對每位收件人依序呼叫 send_plan_join_invitation，200 人就是 200 次 RPC。
-- 這支把判斷和寫入都放在伺服器，一次處理整批，回傳每個人的結果：
--   sent            已送出
--   duplicate       今天已提醒過（同一位發送者、同一計畫、同一天，靠 care_reminders 的唯一鍵）
--   outside_scope   不在呼叫者的管理範圍
--   not_found       找不到人或帳號未啟用
--   self            不用提醒自己
--   already_joined  已經加入這個計畫
--
-- 規則逐條照 send_plan_join_invitation（20260929101811）的現行定義，那支不改不刪，舊版前端繼續用：
-- 同樣的角色清單、同樣的範圍判斷（每位收件人都重查，不信任前端的名單）、同樣的 plan_key 與訊息內容。
-- scripts/db-behavior.test.mjs 用「每個角色 × 每種收件人」實際比對兩支的結果。
--
-- 範圍判斷在 CASE 裡，NULL 會掉到下一個 WHEN 變成可以送，所以用 COALESCE 收成 FALSE：算不出來就當不在範圍內。
--
-- 上限 500 人（去重後）：正式站 profiles 約 1,220 人，全教會都沒報名時前端分 3 批送
-- （js/modules/admin-bulk-plan-invite.mjs 的 PLAN_INVITE_BATCH_MAX_RECIPIENTS，測試確認兩邊一致）。
--
-- 授權只給 service_role：正式站走 nlc-data，p_actor_id 由它依登入者覆寫（TEAM_RPC_FUNCTIONS），
-- 前端傳不進來。本機開發模式直連會被拒，前端退回逐筆單筆 RPC。
-- 上線順序不限：migration 或 nlc-data 哪邊先上，前端都會退回逐筆，不會整批失敗。

CREATE OR REPLACE FUNCTION public.send_plan_join_invitations_batch(
  p_global_plan_id uuid,
  p_recipient_ids uuid[],
  p_plan_key text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_max_recipients CONSTANT integer := 500;
  v_actor_id uuid;
  v_actor_profile public.profiles%ROWTYPE;
  v_actor_role text;
  v_target_plan public.global_plans%ROWTYPE;
  v_recipient_ids uuid[];
  v_plan_key text;
  v_reminder_key text;
  v_message text;
  v_results jsonb;
BEGIN
  v_actor_id := public.resolve_reading_team_actor(p_actor_id);
  SELECT * INTO v_actor_profile FROM public.profiles WHERE id = v_actor_id;
  SELECT * INTO v_target_plan FROM public.global_plans WHERE id = p_global_plan_id;
  v_actor_role := public.role_code(v_actor_profile.role_id);

  IF v_actor_profile.id IS NULL
     OR COALESCE(v_actor_role, '') NOT IN ('admin', 'pastor', 'great_zone_leader', 'zone_leader', 'group_leader') THEN
    RAISE EXCEPTION 'plan_management_scope_required';
  END IF;
  IF v_target_plan.id IS NULL THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  SELECT COALESCE(ARRAY_AGG(DISTINCT requested.recipient_id), ARRAY[]::uuid[])
    INTO v_recipient_ids
    FROM UNNEST(p_recipient_ids) AS requested(recipient_id)
   WHERE requested.recipient_id IS NOT NULL;

  IF CARDINALITY(v_recipient_ids) > v_max_recipients THEN
    RAISE EXCEPTION 'plan_invitation_batch_too_large';
  END IF;

  v_plan_key := NULLIF(BTRIM(p_plan_key), '');
  v_reminder_key := 'plan-invite:' || v_target_plan.id::text;
  v_message := '邀請你加入「' || v_target_plan.name || '」讀經計畫，一起開始讀經吧！';

  WITH classified AS (
    SELECT
      requested.recipient_id,
      CASE
        WHEN recipient.id IS NULL OR recipient.is_active = FALSE THEN 'not_found'
        WHEN recipient.id = v_actor_id THEN 'self'
        WHEN NOT COALESCE(
          v_actor_role IN ('admin', 'pastor')
          OR (
            v_actor_role = 'great_zone_leader'
            AND public.values_overlap(
              recipient.great_region,
              COALESCE(NULLIF(v_actor_profile.managed_regions, ''), v_actor_profile.great_region, '')
            )
          )
          OR (
            v_actor_role = 'zone_leader'
            AND public.values_overlap(
              recipient.pastoral_zone,
              COALESCE(NULLIF(v_actor_profile.managed_zones, ''), v_actor_profile.pastoral_zone, '')
            )
          )
          OR (
            v_actor_role = 'group_leader'
            AND public.values_overlap(
              recipient.small_group,
              COALESCE(NULLIF(v_actor_profile.managed_groups, ''), v_actor_profile.small_group, '')
            )
          ),
          FALSE
        ) THEN 'outside_scope'
        WHEN EXISTS (
          SELECT 1
          FROM public.reading_plans AS reading_plan
          WHERE reading_plan.user_id = recipient.id
            AND (
              reading_plan.global_plan_id = v_target_plan.id
              OR (
                v_plan_key IS NOT NULL
                AND reading_plan.preset_key = v_plan_key
              )
            )
        ) THEN 'already_joined'
        ELSE 'eligible'
      END AS outcome
    FROM UNNEST(v_recipient_ids) AS requested(recipient_id)
    LEFT JOIN public.profiles AS recipient ON recipient.id = requested.recipient_id
  ),
  inserted AS (
    -- 不指定衝突欄位：跟單筆的 WHEN unique_violation 一樣，任何唯一鍵衝突都算今天已提醒
    INSERT INTO public.care_reminders (
      sender_id,
      recipient_id,
      global_plan_id,
      plan_key,
      reason,
      message,
      status,
      sent_on
    )
    SELECT
      v_actor_id,
      classified.recipient_id,
      v_target_plan.id,
      v_reminder_key,
      'encouragement',
      v_message,
      'unread',
      CURRENT_DATE
    FROM classified
    WHERE classified.outcome = 'eligible'
    ON CONFLICT DO NOTHING
    RETURNING care_reminders.recipient_id
  )
  SELECT COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'recipient_id', classified.recipient_id,
        'status', CASE
          WHEN classified.outcome <> 'eligible' THEN classified.outcome
          WHEN inserted.recipient_id IS NOT NULL THEN 'sent'
          ELSE 'duplicate'
        END
      )
    ),
    '[]'::jsonb
  ) INTO v_results
  FROM classified
  LEFT JOIN inserted ON inserted.recipient_id = classified.recipient_id;

  RETURN JSONB_BUILD_OBJECT('results', v_results);
END;
$function$;

REVOKE ALL ON FUNCTION public.send_plan_join_invitations_batch(uuid, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_plan_join_invitations_batch(uuid, uuid[], text, uuid) TO service_role;
