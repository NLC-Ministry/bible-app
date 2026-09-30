-- #355 打卡模型 階段 2：所有打卡規則集中到伺服器一支 RPC。
--
-- 以前「能不能打卡」散在前端各處（階段開放、計畫到期、第幾遍），資料庫只有 0098 的
-- 階段開放 trigger 兜底。這支 migration 把規則收斂成：
--   record_chapter_read(p_user_id, p_plan_id, p_book, p_chapter, p_round, p_read_at, p_client_id)
--   unrecord_chapter_read(p_user_id, p_plan_id, p_book, p_chapter, p_round, p_client_id)
-- 都回傳 jsonb { ok: boolean, reason: text | null }。
--
-- 規則（依序檢查，第一個不過就回 ok=false）：
--   not_owner       計畫不存在、或不是 p_user_id 的（p_user_id 由 nlc-data 以登入身分注入）
--   invalid_chapter 書卷空白、章數 <= 0
--   stage_not_open  （只有 record）教會階段計畫隱藏中或還沒到開始日（跟 0098 trigger 同一套判斷）
--   plan_closed     固定日期計畫：伺服器時間（台北日期）晚於 max(個人計畫迄日, 全教會計畫迄日) + grace_days
--                   （刻意不用前端傳的 p_read_at 判斷，否則把時間往前填就能在截止後補打卡；
--                    離線佇列晚送的延遲由寬限期吸收）
--   old_round       p_round 不是目前這一遍（跟前端 getConfirmedReadingRound 同一套「確認遍數」）
-- 刻意「不」檢查照順序打卡（設計決定 5B）。
--
-- 成功時：
--   record：寫入 reading_logs，ON CONFLICT (user_id, plan_id, book, chapter, round) DO NOTHING；
--           已經有這筆 → ok=true, reason='already_read'（同一筆重送不重複寫 = 冪等）。
--   unrecord：刪掉那一筆；本來就沒有 → ok=true, reason='already_unread'。
--
-- 時間：p_read_at 是前端「按下」的時間（離線補送時會比伺服器時間早），只用來決定寫進
-- reading_logs 的 read_at，不參與任何規則判斷。沒給或比伺服器快 5 分鐘以上（手機時鐘被調快）
-- → now()；否則 read_at = LEAST(now(), GREATEST(p_read_at, now() - 7 天, 計畫開始日台北 00:00))，
-- 不能把紀錄填到一週前或計畫開始之前。前端傳的原始值照樣存進 check_in_events.client_read_at。
--
-- 每次呼叫都寫一筆 check_in_events（#350 監控用），包含被拒絕的。
--
-- 權限：兩支都是 SECURITY DEFINER 的寫入，只 GRANT service_role，client 只能經 nlc-data
-- 的 CHECK_IN_RPC_FUNCTIONS 呼叫，p_user_id 一律被蓋成 Logto 驗證過的 profile.id。
-- 本機 dev（真 Supabase client、authenticated 角色）呼叫不到，前端會退回舊的直接寫表路徑。

-- ── 1. 寬限期 ───────────────────────────────────────────────────────────────
-- 預設 3 天（待教會確認），可逐計畫調整。
ALTER TABLE public.global_plans
  ADD COLUMN IF NOT EXISTS grace_days INTEGER NOT NULL DEFAULT 3;

DO $grace_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'global_plans_grace_days_check'
      AND conrelid = 'public.global_plans'::regclass
  ) THEN
    ALTER TABLE public.global_plans
      ADD CONSTRAINT global_plans_grace_days_check CHECK (grace_days >= 0);
  END IF;
END;
$grace_check$;

COMMENT ON COLUMN public.global_plans.grace_days IS
  '計畫迄日之後仍可補打卡的天數（台北日期）。record_chapter_read / unrecord_chapter_read 使用（#355）。';

-- ── 2. 打卡事件（#350 監控）────────────────────────────────────────────────
-- 刻意不加 FK：事件是稽核紀錄，計畫或使用者刪掉後仍保留。
-- RLS 開啟且沒有任何 policy：只有 service_role（以及上面兩支 SECURITY DEFINER）讀寫得到。
CREATE TABLE IF NOT EXISTS public.check_in_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  plan_id UUID,
  book TEXT,
  chapter INTEGER,
  round INTEGER,
  action TEXT NOT NULL CHECK (action IN ('record', 'unrecord')),
  ok BOOLEAN NOT NULL,
  reason TEXT,
  client_id TEXT,
  client_read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_check_in_events_created_at
  ON public.check_in_events (created_at);

ALTER TABLE public.check_in_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.check_in_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.check_in_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.check_in_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.check_in_events_id_seq TO service_role;

-- ── 3. record_chapter_read ─────────────────────────────────────────────────
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
      INSERT INTO public.reading_logs (user_id, plan_id, book, chapter, round, read_at)
      VALUES (p_user_id, p_plan_id, p_book, p_chapter, p_round, v_read_at)
      ON CONFLICT (user_id, plan_id, book, chapter, round) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
    EXCEPTION WHEN raise_exception THEN
      -- 0098 / 0010 的 trigger 兜底（理論上上面已先擋掉，這裡只防競態）
      IF SQLERRM = 'campaign_stage_progress_not_open' THEN
        v_reason := 'stage_not_open';
        EXIT checks;
      ELSIF SQLERRM = 'reading_log_plan_owner_mismatch' THEN
        v_reason := 'not_owner';
        EXIT checks;
      END IF;
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

-- ── 4. unrecord_chapter_read ───────────────────────────────────────────────
-- 同樣的擁有者／截止＋寬限期／目前這一遍規則（截止以伺服器時間判斷）；不檢查階段開放
-- （還沒開放的階段本來就寫不進紀錄，沒東西可刪）。
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

    DELETE FROM public.reading_logs log
    WHERE log.user_id = p_user_id
      AND log.plan_id = p_plan_id
      AND log.book = p_book
      AND log.chapter = p_chapter
      AND log.round = p_round;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

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

-- ── 5. 自我檢查：client 角色一律呼叫不到 ─────────────────────────────────────
DO $verify_grants$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.record_chapter_read(uuid, uuid, text, integer, integer, timestamptz, text)',
    'public.unrecord_chapter_read(uuid, uuid, text, integer, integer, text)'
  ]
  LOOP
    IF has_function_privilege('anon', fn::regprocedure, 'EXECUTE')
       OR has_function_privilege('authenticated', fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% must be service_role-only', fn;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.check_in_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.check_in_events', 'SELECT') THEN
    RAISE EXCEPTION 'public.check_in_events must not be readable by client roles';
  END IF;
END;
$verify_grants$;
