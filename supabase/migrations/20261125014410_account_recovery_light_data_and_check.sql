-- ============================================================================
-- 20261125014410_account_recovery_light_data_and_check.sql  —  #715
--
-- 自助找回計畫（#664、#712）還是常被擋，會友按了「找回」才知道不行。這支：
--
--   account_recovery_source_refusal：
--     · 角色改成和目標同一個規則：只擋能管理計畫或權限的角色。會員中心可能一開始就把新帳號
--       標成小組長（nlc-session resolveSyncedRoleId），以前來源只收 member，小組長永遠找不回。
--     · 畫線（highlights）、經文筆記（verse_notes）、按讚（devotional_likes）不算實質資料，
--       合併時照 admin_merge_profiles 搬到舊帳號。三張表的外鍵都是 ON DELETE CASCADE，撞唯一鍵時
--       通用規則會刪掉來源那一列。
--   account_recovery_merge：同一節兩邊都有經文筆記就拒絕（outcome = verse_note_conflict），
--     不讓通用規則丟掉會友寫的內容；畫線（留舊帳號的顏色）和按讚撞到照常合併。
--   account_recovery_check（新）：recover-plan 的 check 用，顯示「找回」按鈕前先問能不能找回。
--     只跑 account_recovery_source_refusal：不留 challenge、不算進頻率、不回原因（不能拿來探測帳號）。
--
-- 其餘內容照 20261124050213。兩個既有函式簽章不變；舊版 App 不會呼叫 check：
-- 不需要 forceUpdateBuiltBefore。recover-plan 要重新部署才有 check，部署前新前端的 check 失敗，
-- 照舊顯示「找回」按鈕。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.account_recovery_source_refusal(p_source_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $account_recovery_source_refusal$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_role public.role_definitions%ROWTYPE;
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

  -- #715：和目標同一個規則。會員中心可能一開始就把新帳號標成小組長，只擋能管理計畫或權限的角色。
  SELECT * INTO v_role FROM public.role_definitions r WHERE r.id = v_profile.role_id;
  IF NOT FOUND OR v_role.can_manage_plans OR v_role.can_manage_permissions THEN RETURN 'source_role'; END IF;
  IF v_profile.managed_regions <> '' OR v_profile.managed_zones <> '' OR v_profile.managed_groups <> '' THEN
    RETURN 'source_managed_scope';
  END IF;

  IF (SELECT count(*) FROM public.user_identities i WHERE i.profile_id = p_source_id) <> 1 THEN
    RETURN 'source_identities';
  END IF;

  -- 雲柱作答可以搬，但公布過的週排名是存下來的快照（entries 的得獎者、excluded 的排除名單），
  -- 裡面的 user id 合併後還是來源：重新公布時排除會失效。出現在任何一週就交給人工。
  IF EXISTS (SELECT 1 FROM public.lightning_quiz_week_rankings w
             WHERE strpos(w.entries::text, p_source_id::text) > 0
                OR strpos(w.excluded::text, p_source_id::text) > 0) THEN
    RETURN 'source_lightning_quiz_ranked';
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
        ('public.issue_report_messages', 'author_id'),
        ('public.lightning_quiz_attempts', 'user_id'),
        ('public.highlights', 'user_id'),
        ('public.verse_notes', 'user_id'),
        ('public.devotional_likes', 'user_id')
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

      -- 同一題兩個帳號都答過：合併的通用規則會留目標那筆、刪掉來源那筆，等於一人答兩次挑一筆留。
      -- 公平起見不自動決定，交給人工合併（先預覽）。
      IF v_refusal IS NULL AND EXISTS (
        SELECT 1 FROM public.lightning_quiz_attempts s
        JOIN public.lightning_quiz_attempts t ON t.question_id = s.question_id AND t.user_id = v_target_id
        WHERE s.user_id = v_source_id
      ) THEN
        v_refusal := 'lightning_quiz_conflict';
      END IF;

      -- #715：同一節兩邊都有經文筆記，合併的通用規則會刪掉來源那份（ON DELETE CASCADE），等於丟掉會友寫的內容。
      -- 畫線（只是顏色，留目標的）和按讚（兩邊一樣）撞到就照通用規則，不擋。
      IF v_refusal IS NULL AND EXISTS (
        SELECT 1 FROM public.verse_notes s
        JOIN public.verse_notes t ON t.user_id = v_target_id
          AND t.book = s.book AND t.chapter = s.chapter AND t.verse = s.verse
        WHERE s.user_id = v_source_id
      ) THEN
        v_refusal := 'verse_note_conflict';
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

-- 回傳 { ok: true, eligible }。sub 查無帳號也是 eligible false。不寫入任何資料。
CREATE OR REPLACE FUNCTION public.account_recovery_check(p_source_sub TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $account_recovery_check$
DECLARE
  v_source_id UUID;
BEGIN
  SELECT i.profile_id INTO v_source_id
  FROM public.user_identities i
  WHERE i.provider = 'logto' AND i.provider_user_id = p_source_sub;
  RETURN jsonb_build_object(
    'ok', TRUE,
    'eligible', v_source_id IS NOT NULL AND public.account_recovery_source_refusal(v_source_id) IS NULL
  );
END;
$account_recovery_check$;
REVOKE ALL ON FUNCTION public.account_recovery_check(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_recovery_check(TEXT) TO service_role;
