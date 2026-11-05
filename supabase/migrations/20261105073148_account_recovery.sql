-- ============================================================================
-- 20261105073148_account_recovery.sql  —  #664
--
-- 會友換登入方式開出新的空帳號時，讓他自己驗證舊的登入方式後把計畫找回來。
-- 呼叫端只有 Edge Function recover-plan，它驗過兩個 Logto token 後把 sub 傳進來；
-- 這裡不收 token，也不存 token。合併的條件全部在這裡重查，前端與裝置紀錄都不算數。
--
--   account_recovery_start(新帳號 sub, nonce 雜湊)
--     確認來源是空帳號、沒超過頻率，留下一次性的 challenge。nonce 本身當 OIDC nonce 送給 Logto，
--     所以舊帳號的 id_token 會帶著它，證明這次登入是為了這次找回做的。DB 只存雜湊。
--
--   account_recovery_merge(新帳號 sub, 舊帳號 sub, nonce 雜湊, auth_time, request id)
--     鎖住 challenge 與兩個帳號、重查條件、呼叫 admin_merge_profiles，在 profile_merges
--     記下觸發來源。全部在同一個交易，一句 SELECT 呼叫，沒有先讀那些表（否則 55006）。
--
-- 三個擋「不是本人剛剛同意」的條件都在這裡判斷（獨立安全審查）：
--   · auth_time 必填，而且要晚於 challenge 發出的時間。prompt=login、max_age=0 是前端決定的，
--     有人自己組授權網址就能略過重新登入；伺服器只信 id_token 裡驗過簽的 auth_time。
--   · 兩邊都有牧區而且不同：最可能是不同的人，拒絕。只有一邊有牧區，或牧區相同仍允許，
--     否則會擋到已被會員中心核准的本人（新帳號也可能很快就有牧區）。
--
-- 合併方向：來源＝新的空帳號、目標＝舊帳號，和維護者 2026-11-02 手動合併的 4 位相反
-- （那 4 位已在新帳號讀了一陣子，所以保留新帳號）。這裡來源一定是空的，保留舊帳號才對：
-- 舊帳號的 ID、團隊、組織與會員 ID 都不動，會友回到的就是原本的帳號。#665 的保留邏輯也靠這個方向：
-- 目標保留原本的 nlc_member_id，之後用新方式登入是透過 identity 對應進來、會員 ID 不同，
-- 這次的會員沒有牧區就保留帳號的牧區與角色。
--
-- 只新增函式與資料表，舊版 App 不會呼叫：不需要 forceUpdateBuiltBefore。
-- 要等這支 migration 上線後，recover-plan 才能用；前端在這之前會顯示暫時無法找回。
-- ============================================================================

CREATE TABLE public.account_recovery_challenges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 不設外鍵：admin_merge_profiles 會把所有參照 profiles 的欄位改指目標，這裡要留著原本的來源
  source_profile_id UUID NOT NULL,
  target_profile_id UUID,
  nonce_hash        TEXT UNIQUE CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  consumed_at       TIMESTAMPTZ,
  outcome           TEXT
);
CREATE INDEX idx_account_recovery_challenges_source
  ON public.account_recovery_challenges (source_profile_id, created_at DESC);
ALTER TABLE public.account_recovery_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_recovery_challenges FROM PUBLIC, anon, authenticated, service_role;

-- 來源要是「剛開出來、還沒有實質資料」的帳號。回傳拒絕原因，可以合併回 NULL。
-- 從 pg_constraint 動態掃所有參照 profiles 的欄位：之後新增的資料表預設算實質資料（fail closed）。
-- 例外只有不是會友自己產生、或就是在講這件事的內容；它們會跟著 admin_merge_profiles 搬到目標：
--   身分（下面另外要求剛好一筆）、別人發給他的通知與關心提醒、回報「計畫不見了」的對話。
CREATE OR REPLACE FUNCTION public.account_recovery_source_refusal(p_source_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $account_recovery_source_refusal$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_role_code TEXT;
  v_fk RECORD;
  v_has_rows BOOLEAN;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_source_id;
  IF NOT FOUND THEN RETURN 'source_missing'; END IF;
  IF NOT COALESCE(v_profile.is_active, FALSE) THEN RETURN 'source_inactive'; END IF;
  IF v_profile.created_at IS NULL OR v_profile.created_at <= now() - INTERVAL '30 days' THEN
    RETURN 'source_too_old';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profile_merges m
             WHERE p_source_id IN (m.source_profile_id, m.target_profile_id)) THEN
    RETURN 'source_merged';
  END IF;

  SELECT r.code INTO v_role_code FROM public.role_definitions r WHERE r.id = v_profile.role_id;
  IF v_role_code IS DISTINCT FROM 'member' THEN RETURN 'source_role'; END IF;
  IF v_profile.managed_regions <> '' OR v_profile.managed_zones <> '' OR v_profile.managed_groups <> '' THEN
    RETURN 'source_managed_scope';
  END IF;

  IF (SELECT count(*) FROM public.user_identities i WHERE i.profile_id = p_source_id) <> 1 THEN
    RETURN 'source_identities';
  END IF;

  FOR v_fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.profiles'::regclass
      -- search_path 是空的，regclass 轉文字一定帶 schema
      AND (c.conrelid::regclass::text, a.attname::text) NOT IN (
        ('public.user_identities', 'profile_id'),
        ('public.care_reminders', 'recipient_id'),
        ('public.quiz_notifications', 'recipient_id'),
        ('public.exam_notifications', 'recipient_id'),
        ('public.commentary_review_notifications', 'recipient_id'),
        ('public.issue_reports', 'user_id'),
        ('public.issue_report_messages', 'author_id')
      )
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_fk.tbl, v_fk.col)
      INTO v_has_rows USING p_source_id;
    IF v_has_rows THEN RETURN 'source_has_data'; END IF;
  END LOOP;

  RETURN NULL;
END;
$account_recovery_source_refusal$;
REVOKE ALL ON FUNCTION public.account_recovery_source_refusal(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_recovery_source_refusal(UUID) TO service_role;

-- 目標要是比來源舊、有計畫、還在使用的帳號；管理者帳號不走這條路，請維護者手動處理。
-- 小組長（不能管理計畫、沒有委任範圍）可以：一樣是會友自己的紀錄。
CREATE OR REPLACE FUNCTION public.account_recovery_target_refusal(p_target_id UUID, p_source_created_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $account_recovery_target_refusal$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_role public.role_definitions%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_target_id;
  IF NOT FOUND THEN RETURN 'target_missing'; END IF;
  IF NOT COALESCE(v_profile.is_active, FALSE) THEN RETURN 'target_inactive'; END IF;
  IF EXISTS (SELECT 1 FROM public.profile_merges m WHERE m.source_profile_id = p_target_id) THEN
    RETURN 'target_merged';
  END IF;
  IF v_profile.created_at IS NULL OR v_profile.created_at >= p_source_created_at THEN
    RETURN 'target_not_older';
  END IF;

  SELECT * INTO v_role FROM public.role_definitions r WHERE r.id = v_profile.role_id;
  IF NOT FOUND OR v_role.can_manage_plans OR v_role.can_manage_permissions THEN
    RETURN 'target_role';
  END IF;
  IF v_profile.managed_regions <> '' OR v_profile.managed_zones <> '' OR v_profile.managed_groups <> '' THEN
    RETURN 'target_managed_scope';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.reading_plans p WHERE p.user_id = p_target_id) THEN
    RETURN 'target_no_plans';
  END IF;

  RETURN NULL;
END;
$account_recovery_target_refusal$;
REVOKE ALL ON FUNCTION public.account_recovery_target_refusal(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_recovery_target_refusal(UUID, TIMESTAMPTZ) TO service_role;

-- 回傳 { ok: true } 或 { ok: false, code }。不回任何帳號資料。
-- 被拒絕的嘗試也留一筆並算進頻率：同一個帳號一小時最多 5 次。
CREATE OR REPLACE FUNCTION public.account_recovery_start(p_source_sub TEXT, p_nonce_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $account_recovery_start$
DECLARE
  v_source_id UUID;
  v_refusal TEXT;
BEGIN
  SELECT i.profile_id INTO v_source_id
  FROM public.user_identities i
  WHERE i.provider = 'logto' AND i.provider_user_id = p_source_sub;
  IF v_source_id IS NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'not_eligible');
  END IF;

  -- 同一個帳號同時間只跑一個，頻率計數才準
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_source_id::text, 664));

  IF (SELECT count(*) FROM public.account_recovery_challenges c
      WHERE c.source_profile_id = v_source_id AND c.created_at > now() - INTERVAL '1 hour') >= 5 THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'rate_limited');
  END IF;

  DELETE FROM public.account_recovery_challenges c WHERE c.created_at < now() - INTERVAL '30 days';

  -- 新的開始後，舊的 challenge 就不能用了
  UPDATE public.account_recovery_challenges c
  SET consumed_at = now(), outcome = 'superseded'
  WHERE c.source_profile_id = v_source_id AND c.consumed_at IS NULL;

  v_refusal := public.account_recovery_source_refusal(v_source_id);
  IF v_refusal IS NOT NULL THEN
    INSERT INTO public.account_recovery_challenges (source_profile_id, expires_at, consumed_at, outcome)
    VALUES (v_source_id, now(), now(), v_refusal);
    RETURN jsonb_build_object('ok', FALSE, 'code', 'not_eligible');
  END IF;

  INSERT INTO public.account_recovery_challenges (source_profile_id, nonce_hash, expires_at)
  VALUES (v_source_id, p_nonce_hash, now() + INTERVAL '15 minutes');
  RETURN jsonb_build_object('ok', TRUE);
END;
$account_recovery_start$;
REVOKE ALL ON FUNCTION public.account_recovery_start(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_recovery_start(TEXT, TEXT) TO service_role;

-- lock_timeout：admin_merge_profiles 要 ALTER TABLE 暫停觸發器，遇到長查詢會排隊，後面所有人又排在它後面。
-- 這條路是會友自己觸發的，等不到鎖就放棄（busy），不拖累全站；challenge 不會用掉，前端可以重試。
-- advisory lock：同一時間全站只跑一件合併。
CREATE OR REPLACE FUNCTION public.account_recovery_merge(
  p_source_sub TEXT,
  p_target_sub TEXT,
  p_nonce_hash TEXT,
  p_target_auth_time TIMESTAMPTZ,
  p_request_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $account_recovery_merge$
DECLARE
  v_challenge public.account_recovery_challenges%ROWTYPE;
  v_source_id UUID;
  v_target_id UUID;
  v_source_created_at TIMESTAMPTZ;
  v_source_zone TEXT;
  v_target_zone TEXT;
  v_refusal TEXT;
  v_left INTEGER;
BEGIN
  SELECT * INTO v_challenge FROM public.account_recovery_challenges c
  WHERE c.nonce_hash = p_nonce_hash FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'challenge_invalid');
  END IF;

  SELECT i.profile_id INTO v_source_id FROM public.user_identities i
  WHERE i.provider = 'logto' AND i.provider_user_id = p_source_sub;
  SELECT i.profile_id INTO v_target_id FROM public.user_identities i
  WHERE i.provider = 'logto' AND i.provider_user_id = p_target_sub;

  IF v_challenge.consumed_at IS NOT NULL THEN
    -- 合併成功但回應沒送到、前端重試：兩個 sub 都已經對應到當初的目標，就回成功，不重做。
    IF v_challenge.outcome = 'merged'
       AND v_source_id = v_challenge.target_profile_id
       AND v_target_id = v_challenge.target_profile_id THEN
      RETURN jsonb_build_object('ok', TRUE, 'alreadyDone', TRUE);
    END IF;
    RETURN jsonb_build_object('ok', FALSE, 'code', 'challenge_invalid');
  END IF;

  -- 到這裡起這個 challenge 只能用一次，下面的拒絕都會用掉它
  IF v_challenge.expires_at <= now() THEN
    v_refusal := 'expired';
  ELSIF v_source_id IS DISTINCT FROM v_challenge.source_profile_id THEN
    v_refusal := 'source_mismatch';
  ELSIF v_target_id IS NULL THEN
    v_refusal := 'target_missing';
  ELSIF v_target_id = v_source_id THEN
    v_refusal := 'same_account';
  ELSIF p_target_auth_time IS NULL THEN
    v_refusal := 'target_auth_time_missing';
  ELSIF p_target_auth_time <= v_challenge.created_at THEN
    v_refusal := 'target_login_stale';
  END IF;

  IF v_refusal IS NULL THEN
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('account_recovery_merge', 664)) THEN
      RETURN jsonb_build_object('ok', FALSE, 'code', 'busy');
    END IF;

    BEGIN
      -- 固定順序鎖兩個帳號，條件查完到合併之間不會變
      PERFORM 1 FROM public.profiles p WHERE p.id IN (v_source_id, v_target_id) ORDER BY p.id FOR UPDATE;

      v_refusal := public.account_recovery_source_refusal(v_source_id);
      IF v_refusal IS NULL THEN
        SELECT p.created_at INTO v_source_created_at FROM public.profiles p WHERE p.id = v_source_id;
        v_refusal := public.account_recovery_target_refusal(v_target_id, v_source_created_at);
      END IF;

      -- 上面已經鎖住兩個帳號，這裡讀到的就是合併當下的值
      IF v_refusal IS NULL THEN
        SELECT NULLIF(BTRIM(p.pastoral_zone), '') INTO v_source_zone FROM public.profiles p WHERE p.id = v_source_id;
        SELECT NULLIF(BTRIM(p.pastoral_zone), '') INTO v_target_zone FROM public.profiles p WHERE p.id = v_target_id;
        IF v_source_zone <> v_target_zone THEN
          v_refusal := 'pastoral_zone_mismatch';
        END IF;
      END IF;

      IF v_refusal IS NULL THEN
        PERFORM public.admin_merge_profiles(v_source_id, v_target_id, FALSE);

        -- 登入身分沒有搬過去，另一種方式登入還是會開到舊的空帳號：整筆回滾
        SELECT count(*) INTO v_left FROM public.user_identities i WHERE i.profile_id = v_source_id;
        IF v_left <> 0 THEN
          RAISE EXCEPTION 'account_recovery_identity_not_moved' USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.profile_merges m
        SET report = m.report || jsonb_build_object('trigger', jsonb_build_object(
          'source', 'self_service_recovery',
          'function', 'recover-plan',
          'challengeId', v_challenge.id,
          'requestId', p_request_id
        ))
        WHERE m.source_profile_id = v_source_id;

        UPDATE public.account_recovery_challenges c
        SET consumed_at = now(), outcome = 'merged', target_profile_id = v_target_id
        WHERE c.id = v_challenge.id;
        RETURN jsonb_build_object('ok', TRUE);
      END IF;
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected THEN
        RETURN jsonb_build_object('ok', FALSE, 'code', 'busy');
      WHEN OTHERS THEN
        v_refusal := 'merge_failed:' || SQLSTATE;
    END;
  END IF;

  UPDATE public.account_recovery_challenges c
  SET consumed_at = now(), outcome = v_refusal, target_profile_id = v_target_id
  WHERE c.id = v_challenge.id;
  RETURN jsonb_build_object('ok', FALSE, 'code', CASE
    WHEN v_refusal = 'same_account' THEN 'same_account'
    WHEN v_refusal IN ('expired', 'source_mismatch') THEN 'challenge_invalid'
    WHEN v_refusal LIKE 'merge_failed:%' THEN 'merge_failed'
    ELSE 'not_eligible'
  END);
END;
$account_recovery_merge$;
REVOKE ALL ON FUNCTION public.account_recovery_merge(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_recovery_merge(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO service_role;

-- 合併的當下，另一台裝置的 nlc-session 可能還在跑：它先查到來源帳號，合併後才寫入（一次 3～5 秒），
-- 會把身分和啟用狀態寫回來源。身分回到來源後，那個登入方式又看不到計畫，重試也會被 source_merged 擋住。
-- 手動的 admin_merge_profiles 也有同樣的窗口，所以放在資料庫：不用改 nlc-session、不多一次查詢的來回。
-- 要手動復原一筆合併，先刪掉 profile_merges 那一列，否則身分寫回來源時會被導回目標。
CREATE OR REPLACE FUNCTION public.keep_identity_on_merge_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $keep_identity_on_merge_target$
DECLARE
  v_target UUID;
BEGIN
  LOOP
    -- admin_merge_profiles 不接受已被併掉的目標，所以這條鏈不會繞圈
    SELECT m.target_profile_id INTO v_target FROM public.profile_merges m WHERE m.source_profile_id = NEW.profile_id;
    EXIT WHEN NOT FOUND;
    NEW.profile_id := v_target;
    NEW.is_primary := FALSE;
  END LOOP;
  RETURN NEW;
END;
$keep_identity_on_merge_target$;
REVOKE ALL ON FUNCTION public.keep_identity_on_merge_target() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_identity_on_merge_target() TO service_role;

CREATE TRIGGER keep_identity_on_merge_target_insert
  BEFORE INSERT ON public.user_identities
  FOR EACH ROW EXECUTE FUNCTION public.keep_identity_on_merge_target();
CREATE TRIGGER keep_identity_on_merge_target_update
  BEFORE UPDATE OF profile_id ON public.user_identities
  FOR EACH ROW WHEN (OLD.profile_id IS DISTINCT FROM NEW.profile_id)
  EXECUTE FUNCTION public.keep_identity_on_merge_target();

-- 同一個窗口也會把來源寫回啟用，並帶回會員 ID、email、手機。只有「停用變啟用」才查，平常的更新不多花時間。
CREATE OR REPLACE FUNCTION public.keep_merged_profile_inactive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $keep_merged_profile_inactive$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profile_merges m WHERE m.source_profile_id = NEW.id) THEN
    NEW.is_active := FALSE;
    NEW.nlc_member_id := NULL;
    NEW.email := NULL;
    NEW.phone := NULL;
  END IF;
  RETURN NEW;
END;
$keep_merged_profile_inactive$;
REVOKE ALL ON FUNCTION public.keep_merged_profile_inactive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_merged_profile_inactive() TO service_role;

CREATE TRIGGER keep_merged_profile_inactive
  BEFORE UPDATE OF is_active ON public.profiles
  FOR EACH ROW WHEN (OLD.is_active IS DISTINCT FROM TRUE AND NEW.is_active IS TRUE)
  EXECUTE FUNCTION public.keep_merged_profile_inactive();
