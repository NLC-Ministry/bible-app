-- #359 打卡模型 階段 6：計畫內打卡只能經 record_chapter_read / unrecord_chapter_read。
--
-- 以前任何 client（含舊版前端、以及 nlc-data 的一般表格寫入）都能直接 insert/update/delete
-- reading_logs，繞過 #355 集中在伺服器的打卡規則（擁有者、階段開放、截止＋寬限期、目前這一遍）。
-- 這支 migration 讓 plan_id 不是 NULL 的 reading_logs 只能由那兩支 RPC 寫入：
--
--   1. record_chapter_read / unrecord_chapter_read（CREATE OR REPLACE，內容跟
--      20260930042246_record_chapter_read.sql 相同，只多了：寫 reading_logs 的那一句
--      前面 PERFORM set_config('app.check_in_rpc', 'on', true);、後面立刻設回 'off'，
--      出錯時也在 EXCEPTION WHEN OTHERS 裡設回 'off' 再 RAISE）＋同樣的 REVOKE / GRANT。
--      旗標只在那一句 DML 期間是 'on'：函式回傳後，同一個交易裡後面的語句不會跟著繞過 trigger。
--   2. 新 trigger trg_reading_logs_check_in_rpc_only（BEFORE INSERT OR UPDATE OR DELETE，FOR EACH ROW）：
--      受影響的列 plan_id 不是 NULL（UPDATE 看新舊兩邊）而且 app.check_in_rpc 不是 'on'
--      → RAISE EXCEPTION 'check_in_via_rpc_only'。
--      自由閱讀（plan_id NULL）照舊可以直接寫。
--
-- 放行（exempt）的維護路徑 —— 先 grep 過 migrations 與 Edge Functions 裡所有寫 reading_logs 的地方：
--   a. FK ON DELETE CASCADE：刪 reading_plans（退出計畫、後台刪計畫、0017/0018/0026/0151 類清理）
--      或刪 profiles 時連帶刪掉的紀錄。cascade 是由 RI trigger 執行 DELETE，
--      所以 trigger 裡 pg_trigger_depth() > 1；只對 DELETE 放行（沒有 ON UPDATE CASCADE）。
--   b. 「重置計畫進度」（plan.js 的 reset-plan-progress-btn：delete eq(user_id) eq(plan_id)）：
--      nlc-data 改把這種 delete 轉給新的 reset_plan_reading_logs(p_user_id, p_plan_id)
--      （SECURITY DEFINER、service_role only、檢查擁有者、設同一個旗標）。
--   c. 以前一次性的資料修正（0010 去重、0142 月度拆分、0204 合併重複熱身計畫）都是
--      migration 裡的 DO/DML，早已套用，不會再跑；沒有任何其他 SQL 函式或 Edge Function 寫 reading_logs
--      （nlc-session 不碰、profile 合併也不搬 reading_logs）。
--   d. 手動維護 SQL（例如 #349 的補勾）：在同一個交易裡先
--      SELECT set_config('app.check_in_rpc', 'on', true); 再寫。
--      client 碰不到這個旗標：PostgREST 只暴露 public schema 的函式，nlc-data 只呼叫白名單 RPC。
--
-- 本機 dev（真 Supabase client、authenticated 角色）呼叫不到 service_role-only 的 RPC，
-- 計畫內打卡在 dev 會失敗（前端 #359 已拿掉直接寫表的退路）；要在 dev 測打卡請走 nlc-data。
--
-- 部署順序（正式站）：前端先上（release-policy.json forceUpdateBuiltBefore 會讓舊版立刻更新）、
-- 確認新版比例，再套這支 migration，並重新部署 nlc-data。

-- ── 1. record_chapter_read（同 #355，多設旗標）──────────────────────────────
CREATE OR REPLACE FUNCTION public.record_chapter_read(
  p_user_id UUID,
  p_plan_id UUID,
  p_book TEXT,
  p_chapter INTEGER,
  p_round INTEGER,
  p_read_at TIMESTAMPTZ DEFAULT NULL,
  p_client_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_chapter_read$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_read_at TIMESTAMPTZ;
  v_enrollment public.reading_plans%ROWTYPE;
  v_global public.global_plans%ROWTYPE;
  v_has_global BOOLEAN := FALSE;
  v_end_date DATE;
  v_current_round INTEGER;
  v_ok BOOLEAN := FALSE;
  v_reason TEXT := NULL;
  v_inserted INTEGER := 0;
BEGIN
  <<checks>>
  BEGIN
    SELECT * INTO v_enrollment
    FROM public.reading_plans enrollment
    WHERE enrollment.id = p_plan_id;

    IF p_user_id IS NULL OR NOT FOUND OR v_enrollment.user_id IS DISTINCT FROM p_user_id THEN
      v_reason := 'not_owner';
      EXIT checks;
    END IF;

    -- 寫入的 read_at：只影響紀錄時間，不參與截止判斷。
    -- 沒給或比伺服器快 5 分鐘以上（手機時鐘不準）→ now()；
    -- 否則夾在 [max(now()-7 天, 計畫開始日台北 00:00), now()]。
    v_read_at := CASE
      WHEN p_read_at IS NULL OR p_read_at > v_now + INTERVAL '5 minutes' THEN v_now
      ELSE LEAST(v_now, GREATEST(
        p_read_at,
        v_now - INTERVAL '7 days',
        v_enrollment.start_date::TIMESTAMP AT TIME ZONE 'Asia/Taipei'
      ))
    END;

    IF p_book IS NULL OR btrim(p_book) = '' OR p_chapter IS NULL OR p_chapter <= 0 THEN
      v_reason := 'invalid_chapter';
      EXIT checks;
    END IF;

    IF v_enrollment.global_plan_id IS NOT NULL THEN
      SELECT * INTO v_global
      FROM public.global_plans global_plan
      WHERE global_plan.id = v_enrollment.global_plan_id;
      v_has_global := FOUND;
    END IF;

    -- 同 0098 / 0137 trigger：階段計畫隱藏中或還沒開始 → 不收進度
    IF v_has_global
       AND public.is_campaign_stage_kind(v_global.plan_kind)
       AND (v_global.is_hidden
            OR (v_now AT TIME ZONE 'Asia/Taipei')::DATE < v_global.start_date) THEN
      v_reason := 'stage_not_open';
      EXIT checks;
    END IF;

    -- 截止＋寬限期：只管固定日期計畫（跟前端 isPlanExpired 一樣，is_fixed=false 永不到期）。
    -- 迄日取個人計畫與全教會計畫較晚者，後台延長全教會迄日時不會被舊的個人迄日提早關掉。
    IF v_enrollment.is_fixed IS DISTINCT FROM FALSE THEN
      v_end_date := CASE
        WHEN v_has_global THEN GREATEST(v_enrollment.end_date, v_global.end_date)
        ELSE v_enrollment.end_date
      END;
      IF v_end_date IS NOT NULL
         AND (v_now AT TIME ZONE 'Asia/Taipei')::DATE
             > v_end_date + COALESCE(CASE WHEN v_has_global THEN v_global.grace_days END, 3) THEN
        v_reason := 'plan_closed';
        EXIT checks;
      END IF;
    END IF;

    -- 目前這一遍：跟前端 getConfirmedReadingRound 一致 ——
    -- 存的是第 N 遍（N>1）但還沒確認進入、也沒有任何第 N 遍以上的紀錄 → 視為第 1 遍。
    v_current_round := GREATEST(1, COALESCE(v_enrollment.current_round, 1));
    IF v_current_round > 1
       AND v_enrollment.upgrade_prompt_handled IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM public.reading_logs log
         WHERE log.plan_id = p_plan_id
           AND log.user_id = p_user_id
           AND log.round >= v_current_round
       ) THEN
      v_current_round := 1;
    END IF;
    IF p_round IS NULL OR p_round <> v_current_round THEN
      v_reason := 'old_round';
      EXIT checks;
    END IF;

    BEGIN
      PERFORM set_config('app.check_in_rpc', 'on', true);
      INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, round, read_at)
      VALUES (p_user_id, p_plan_id, p_book, p_chapter, p_round, v_read_at)
      ON CONFLICT (user_id, plan_id, book, chapter, round) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      PERFORM set_config('app.check_in_rpc', 'off', true);
    EXCEPTION WHEN raise_exception THEN
      PERFORM set_config('app.check_in_rpc', 'off', true);
      -- 0098 / 0010 的 trigger 兜底（理論上上面已先擋掉，這裡只防競態）
      IF SQLERRM = 'campaign_stage_progress_not_open' THEN
        v_reason := 'stage_not_open';
        EXIT checks;
      ELSIF SQLERRM = 'reading_log_plan_owner_mismatch' THEN
        v_reason := 'not_owner';
        EXIT checks;
      END IF;
      RAISE;
    WHEN OTHERS THEN
      PERFORM set_config('app.check_in_rpc', 'off', true);
      RAISE;
    END;

    v_ok := TRUE;
    v_reason := CASE WHEN v_inserted = 0 THEN 'already_read' ELSE NULL END;
  END checks;

  INSERT INTO public.check_in_events
    (user_id, plan_id, book, chapter, round, action, ok, reason, client_id, client_read_at)
  VALUES
    (p_user_id, p_plan_id, p_book, p_chapter, p_round, 'record', v_ok, v_reason, p_client_id, p_read_at);

  RETURN jsonb_build_object('ok', v_ok, 'reason', v_reason);
END;
$record_chapter_read$;

REVOKE ALL ON FUNCTION public.record_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TIMESTAMPTZ, TEXT)
  TO service_role;

-- ── 2. unrecord_chapter_read（同 #355，多設旗標）────────────────────────────
CREATE OR REPLACE FUNCTION public.unrecord_chapter_read(
  p_user_id UUID,
  p_plan_id UUID,
  p_book TEXT,
  p_chapter INTEGER,
  p_round INTEGER,
  p_client_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $unrecord_chapter_read$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_enrollment public.reading_plans%ROWTYPE;
  v_global public.global_plans%ROWTYPE;
  v_has_global BOOLEAN := FALSE;
  v_end_date DATE;
  v_current_round INTEGER;
  v_ok BOOLEAN := FALSE;
  v_reason TEXT := NULL;
  v_deleted INTEGER := 0;
BEGIN
  <<checks>>
  BEGIN
    SELECT * INTO v_enrollment
    FROM public.reading_plans enrollment
    WHERE enrollment.id = p_plan_id;

    IF p_user_id IS NULL OR NOT FOUND OR v_enrollment.user_id IS DISTINCT FROM p_user_id THEN
      v_reason := 'not_owner';
      EXIT checks;
    END IF;

    IF p_book IS NULL OR btrim(p_book) = '' OR p_chapter IS NULL OR p_chapter <= 0 THEN
      v_reason := 'invalid_chapter';
      EXIT checks;
    END IF;

    IF v_enrollment.global_plan_id IS NOT NULL THEN
      SELECT * INTO v_global
      FROM public.global_plans global_plan
      WHERE global_plan.id = v_enrollment.global_plan_id;
      v_has_global := FOUND;
    END IF;

    IF v_enrollment.is_fixed IS DISTINCT FROM FALSE THEN
      v_end_date := CASE
        WHEN v_has_global THEN GREATEST(v_enrollment.end_date, v_global.end_date)
        ELSE v_enrollment.end_date
      END;
      IF v_end_date IS NOT NULL
         AND (v_now AT TIME ZONE 'Asia/Taipei')::DATE
             > v_end_date + COALESCE(CASE WHEN v_has_global THEN v_global.grace_days END, 3) THEN
        v_reason := 'plan_closed';
        EXIT checks;
      END IF;
    END IF;

    v_current_round := GREATEST(1, COALESCE(v_enrollment.current_round, 1));
    IF v_current_round > 1
       AND v_enrollment.upgrade_prompt_handled IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM public.reading_logs log
         WHERE log.plan_id = p_plan_id
           AND log.user_id = p_user_id
           AND log.round >= v_current_round
       ) THEN
      v_current_round := 1;
    END IF;
    IF p_round IS NULL OR p_round <> v_current_round THEN
      v_reason := 'old_round';
      EXIT checks;
    END IF;

    BEGIN
      PERFORM set_config('app.check_in_rpc', 'on', true);
      DELETE FROM public.reading_logs log
      WHERE log.user_id = p_user_id
        AND log.plan_id = p_plan_id
        AND log.book = p_book
        AND log.chapter = p_chapter
        AND log.round = p_round;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
      PERFORM set_config('app.check_in_rpc', 'off', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('app.check_in_rpc', 'off', true);
      RAISE;
    END;

    v_ok := TRUE;
    v_reason := CASE WHEN v_deleted = 0 THEN 'already_unread' ELSE NULL END;
  END checks;

  INSERT INTO public.check_in_events
    (user_id, plan_id, book, chapter, round, action, ok, reason, client_id, client_read_at)
  VALUES
    (p_user_id, p_plan_id, p_book, p_chapter, p_round, 'unrecord', v_ok, v_reason, p_client_id, NULL);

  RETURN jsonb_build_object('ok', v_ok, 'reason', v_reason);
END;
$unrecord_chapter_read$;

REVOKE ALL ON FUNCTION public.unrecord_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unrecord_chapter_read(UUID, UUID, TEXT, INTEGER, INTEGER, TEXT)
  TO service_role;

-- ── 3. reset_plan_reading_logs：「重置計畫進度」整份清掉 ─────────────────────
-- nlc-data 把 delete reading_logs eq(user_id) eq(plan_id) 轉來這裡，p_user_id 一律是
-- Logto 驗證過的 profile.id。只檢查擁有者（前端本來就只在計畫未結束時開放重置）。
CREATE OR REPLACE FUNCTION public.reset_plan_reading_logs(
  p_user_id UUID,
  p_plan_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $reset_plan_reading_logs$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_plan_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.reading_plans enrollment
    WHERE enrollment.id = p_plan_id
      AND enrollment.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'not_owner' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    PERFORM set_config('app.check_in_rpc', 'on', true);
    DELETE FROM public.reading_logs log
    WHERE log.user_id = p_user_id
      AND log.plan_id = p_plan_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    PERFORM set_config('app.check_in_rpc', 'off', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.check_in_rpc', 'off', true);
    RAISE;
  END;

  RETURN v_deleted;
END;
$reset_plan_reading_logs$;

REVOKE ALL ON FUNCTION public.reset_plan_reading_logs(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_plan_reading_logs(UUID, UUID)
  TO service_role;

-- ── 4. trigger：計畫內紀錄只能經上面三支 RPC 寫 ───────────────────────────────
-- 觸發函式不需要 SECURITY DEFINER（只讀 GUC 與 trigger 深度）；trigger 觸發時不檢查 EXECUTE 權限，
-- 所以照規則只給 service_role。
CREATE OR REPLACE FUNCTION public.enforce_reading_log_check_in_rpc_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $enforce_reading_log_check_in_rpc_only$
DECLARE
  v_plan_bound BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_plan_bound := NEW.plan_id IS NOT NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_plan_bound := OLD.plan_id IS NOT NULL OR NEW.plan_id IS NOT NULL;
  ELSE
    v_plan_bound := OLD.plan_id IS NOT NULL;
  END IF;

  IF v_plan_bound
     AND COALESCE(current_setting('app.check_in_rpc', true), '') <> 'on'
     -- 放行 FK ON DELETE CASCADE（刪 reading_plans / profiles 連帶刪紀錄）
     AND NOT (TG_OP = 'DELETE' AND pg_trigger_depth() > 1) THEN
    RAISE EXCEPTION 'check_in_via_rpc_only'
      USING ERRCODE = 'P0001',
            HINT = 'Plan check-ins must go through record_chapter_read / unrecord_chapter_read (#359).';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$enforce_reading_log_check_in_rpc_only$;

REVOKE ALL ON FUNCTION public.enforce_reading_log_check_in_rpc_only()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_reading_log_check_in_rpc_only()
  TO service_role;

DROP TRIGGER IF EXISTS trg_reading_logs_check_in_rpc_only ON public.reading_logs;
CREATE TRIGGER trg_reading_logs_check_in_rpc_only
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_log_check_in_rpc_only();

-- ── 5. 自我檢查 ──────────────────────────────────────────────────────────────
DO $verify_check_in_rpc_only$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.record_chapter_read(uuid, uuid, text, integer, integer, timestamptz, text)',
    'public.unrecord_chapter_read(uuid, uuid, text, integer, integer, text)',
    'public.reset_plan_reading_logs(uuid, uuid)',
    'public.enforce_reading_log_check_in_rpc_only()'
  ]
  LOOP
    IF has_function_privilege('anon', fn::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be service_role-only', fn;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgname = 'trg_reading_logs_check_in_rpc_only'
      AND tgrelid = 'public.reading_logs'::regclass
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'trg_reading_logs_check_in_rpc_only is missing or disabled';
  END IF;
END;
$verify_check_in_rpc_only$;
