-- ============================================================================
-- 20261105073004_voucher_merchant_view.sql  —  #679 克勞斯店家查看雲柱兌換券紀錄
--
-- 店家帳號（先到會員中心註冊、登入過一次）由系統管理員在後台指定，之後在速讀 App 個人頁看
-- 可使用／已兌換／已過期的券，可以輸入兌換碼查券。只能看，核銷仍由得獎者本人按。
--
-- 1. lightning_quiz_voucher_merchants：授權名單。不用角色表示店家：登入時角色依會員中心
--    同步，對不上就回一般會友（resolveSyncedRoleId）。
-- 2. lightning_quiz_voucher_lookup_limits：查碼失敗次數，防止猜碼。
-- 3. 店家函式：get_my_voucher_merchant_access、get_voucher_merchant_vouchers、
--    lookup_voucher_merchant_code。每次呼叫都重查授權名單，被移除的帳號立刻查不到。
--    回傳欄位是 _lightning_quiz_voucher_merchant_json 的白名單；不沿用
--    _lightning_quiz_voucher_json（含牧區、秒數）和 admin_list_lightning_quiz_vouchers
--    （含會員 ID、管理員姓名）。已作廢的券一律不回。
-- 4. 管理員函式：admin_list_voucher_merchants、admin_search_voucher_merchant_candidates、
--    admin_set_voucher_merchant。只給 role = admin（牧者不行），異動在同一個交易寫稽核。
-- 5. 看名單、查碼都記稽核（voucher_merchant.view_list／voucher_merchant.lookup），記不成就不回。
--
-- 全部只給 service_role，經 nlc-data 注入 p_actor_id。
-- 防猜碼：碼是 6 碼（31 種字元，約 8.9 億組）。格式不對的不查、不算次數；查不到（含已作廢）
-- 算一次失敗，同一帳號一小時內失敗 20 次就鎖到時段結束，鎖住時對的碼也回 rateLimited，
-- 所以不會洩漏「碼存在」。已作廢和不存在的回應完全相同。
--
-- 全部是新增，舊版程式不會呼叫，不需要 forceUpdateBuiltBefore。要一起部署 nlc-data；
-- admin-api 只有稽核紀錄的中文動作名稱，晚點部署只會先顯示英文代碼。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lightning_quiz_voucher_merchants (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.lightning_quiz_voucher_merchants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_quiz_voucher_merchants FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lightning_quiz_voucher_merchants TO service_role;

CREATE TABLE IF NOT EXISTS public.lightning_quiz_voucher_lookup_limits (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_count INT NOT NULL DEFAULT 0
);
ALTER TABLE public.lightning_quiz_voucher_lookup_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_quiz_voucher_lookup_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lightning_quiz_voucher_lookup_limits TO service_role;

-- ── 店家看到的一張券：欄位白名單，呼叫端負責排除已作廢的 ─────────────────────
CREATE OR REPLACE FUNCTION public._lightning_quiz_voucher_merchant_json(v public.lightning_quiz_vouchers, p_today DATE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'code', v.code,
    'name', v.name,
    'riseDate', v.rise_date::TEXT,
    'rank', v.rank,
    'amount', v.amount,
    'status', CASE
      WHEN v.redeemed_at IS NOT NULL THEN 'redeemed'
      WHEN v.expires_on < p_today THEN 'expired'
      ELSE 'available'
    END,
    'redeemedAt', v.redeemed_at,
    'redeemedVia', v.redeemed_via,
    'expiresOn', v.expires_on::TEXT
  );
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_voucher_merchant_json(public.lightning_quiz_vouchers, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_voucher_merchant_json(public.lightning_quiz_vouchers, date) TO service_role;

-- ── 呼叫者要在授權名單上（每次重查）───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._lightning_quiz_require_voucher_merchant(p_actor_id UUID)
RETURNS UUID
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.lightning_quiz_voucher_merchants m WHERE m.profile_id = v_actor_id) THEN
    RAISE EXCEPTION 'voucher_merchant_required';
  END IF;
  RETURN v_actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_require_voucher_merchant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_require_voucher_merchant(uuid) TO service_role;

-- ── 店家：要不要顯示入口 ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_voucher_merchant_access(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  RETURN jsonb_build_object('isMerchant', EXISTS (
    SELECT 1 FROM public.lightning_quiz_voucher_merchants m WHERE m.profile_id = v_actor_id
  ));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_voucher_merchant_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_voucher_merchant_access(uuid) TO service_role;

-- ── 店家：某月的券（p_month＝'YYYY-MM'，NULL＝這個月，台灣時間）────────────────
-- 已兌換的券算兌換那個月（對帳看這個），其他算發券那個月。
CREATE OR REPLACE FUNCTION public.get_voucher_merchant_vouchers(
  p_month TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public._lightning_quiz_require_voucher_merchant(p_actor_id);
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_this_month TEXT := to_char(v_today, 'YYYY-MM');
  v_month TEXT := COALESCE(NULLIF(btrim(p_month), ''), v_this_month);
  v_max_rows CONSTANT INT := 500;
  v_total INT;
  v_redeemed_count INT;
  v_redeemed_amount BIGINT;
  v_vouchers JSONB;
  v_months JSONB;
BEGIN
  IF v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'voucher_merchant_invalid_month';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE v.redeemed_at IS NOT NULL),
         COALESCE(sum(v.amount) FILTER (WHERE v.redeemed_at IS NOT NULL), 0)
  INTO v_total, v_redeemed_count, v_redeemed_amount
  FROM public.lightning_quiz_vouchers v
  WHERE v.voided_at IS NULL
    AND to_char(COALESCE(v.redeemed_at, v.issued_at) AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month;

  SELECT COALESCE(jsonb_agg(public._lightning_quiz_voucher_merchant_json(t, v_today) ORDER BY t.rise_date DESC, t.rank, t.code), '[]'::jsonb)
  INTO v_vouchers
  FROM (
    SELECT v.*
    FROM public.lightning_quiz_vouchers v
    WHERE v.voided_at IS NULL
      AND to_char(COALESCE(v.redeemed_at, v.issued_at) AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month
    ORDER BY v.rise_date DESC, v.rank, v.code
    LIMIT v_max_rows
  ) t;

  SELECT jsonb_agg(m.month ORDER BY m.month DESC)
  INTO v_months
  FROM (
    SELECT to_char(COALESCE(v.redeemed_at, v.issued_at) AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') AS month
    FROM public.lightning_quiz_vouchers v
    WHERE v.voided_at IS NULL
    UNION SELECT v_this_month
    UNION SELECT v_month
  ) m;

  PERFORM audit.record(
    'nlc-data', 'voucher_merchant.view_list', 'ok', v_actor_id,
    public.role_code((SELECT p.role_id FROM public.profiles p WHERE p.id = v_actor_id)),
    'lightning_quiz_vouchers', NULL, v_month, NULL, NULL, NULL,
    jsonb_build_object('month', v_month, 'rows', v_total)
  );

  RETURN jsonb_build_object(
    'today', v_today::TEXT,
    'month', v_month,
    'months', v_months,
    'summary', jsonb_build_object('redeemedCount', v_redeemed_count, 'redeemedAmount', v_redeemed_amount),
    'vouchers', v_vouchers,
    'truncated', v_total > v_max_rows
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_voucher_merchant_vouchers(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voucher_merchant_vouchers(text, uuid) TO service_role;

-- ── 店家：輸入兌換碼查券（不受月份限制）───────────────────────────────────────
-- 錯誤一律用回傳值，不 RAISE：RAISE 會把這次的失敗次數一起回滾。
CREATE OR REPLACE FUNCTION public.lookup_voucher_merchant_code(
  p_code TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public._lightning_quiz_require_voucher_merchant(p_actor_id);
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v_role TEXT := public.role_code((SELECT p.role_id FROM public.profiles p WHERE p.id = v_actor_id));
  v_max_failures CONSTANT INT := 20;
  v_window CONSTANT INTERVAL := INTERVAL '1 hour';
  v_miss CONSTANT JSONB := jsonb_build_object('found', FALSE, 'rateLimited', FALSE, 'voucher', NULL);
  v_code TEXT := '';
  v_failed INT;
  v_voucher public.lightning_quiz_vouchers%ROWTYPE;
BEGIN
  IF char_length(COALESCE(p_code, '')) <= 32 THEN
    v_code := upper(regexp_replace(COALESCE(p_code, ''), '[[:space:]-]', '', 'g'));
  END IF;

  -- 這一列同時是同一個帳號的鎖：同時送很多次也是一次一次數。
  INSERT INTO public.lightning_quiz_voucher_lookup_limits AS l (profile_id, window_started_at, failed_count)
  VALUES (v_actor_id, NOW(), 0)
  ON CONFLICT (profile_id) DO UPDATE SET
    window_started_at = CASE WHEN l.window_started_at <= NOW() - v_window THEN NOW() ELSE l.window_started_at END,
    failed_count = CASE WHEN l.window_started_at <= NOW() - v_window THEN 0 ELSE l.failed_count END
  RETURNING l.failed_count INTO v_failed;

  IF v_failed >= v_max_failures THEN
    PERFORM audit.record(
      'nlc-data', 'voucher_merchant.lookup', 'denied', v_actor_id, v_role,
      'lightning_quiz_vouchers', NULL, NULL, NULL, 'rate_limited', NULL,
      jsonb_build_object('found', FALSE, 'rate_limited', TRUE)
    );
    RETURN jsonb_build_object('found', FALSE, 'rateLimited', TRUE, 'voucher', NULL);
  END IF;

  -- 兌換碼字元集同 _lightning_quiz_voucher_code：6 碼，不含 0/O、1/I/L。不可能存在的不查。
  IF v_code !~ '^[A-HJKMNP-Z2-9]{6}$' THEN
    RETURN v_miss;
  END IF;

  SELECT * INTO v_voucher
  FROM public.lightning_quiz_vouchers v
  WHERE v.code = v_code AND v.voided_at IS NULL;

  PERFORM audit.record(
    'nlc-data', 'voucher_merchant.lookup', 'ok', v_actor_id, v_role,
    'lightning_quiz_vouchers', NULL, v_code, NULL, NULL, NULL,
    jsonb_build_object('found', v_voucher.id IS NOT NULL, 'rate_limited', FALSE)
  );

  IF v_voucher.id IS NULL THEN
    UPDATE public.lightning_quiz_voucher_lookup_limits
    SET failed_count = failed_count + 1
    WHERE profile_id = v_actor_id;
    RETURN v_miss;
  END IF;

  RETURN jsonb_build_object(
    'found', TRUE,
    'rateLimited', FALSE,
    'voucher', public._lightning_quiz_voucher_merchant_json(v_voucher, v_today)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.lookup_voucher_merchant_code(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_voucher_merchant_code(text, uuid) TO service_role;

-- ── 管理員：只有 role = admin。_lightning_quiz_actor_is_admin 也放行牧者，這裡不用 ─────
CREATE OR REPLACE FUNCTION public._voucher_merchant_assert_admin(p_actor_id UUID)
RETURNS UUID
LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public.resolve_quiz_actor(p_actor_id);
BEGIN
  IF public.role_code((SELECT p.role_id FROM public.profiles p WHERE p.id = v_actor_id)) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  RETURN v_actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public._voucher_merchant_assert_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._voucher_merchant_assert_admin(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._voucher_merchant_list_json()
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'profileId', m.profile_id,
    'name', p.name,
    'emailMasked', public.admin_api_mask_email(p.email),
    'pastoralZone', p.pastoral_zone,
    'addedAt', m.added_at
  ) ORDER BY m.added_at, p.name, m.profile_id), '[]'::jsonb)
  FROM public.lightning_quiz_voucher_merchants m
  JOIN public.profiles p ON p.id = m.profile_id;
$$;
REVOKE ALL ON FUNCTION public._voucher_merchant_list_json() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._voucher_merchant_list_json() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_voucher_merchants(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public._voucher_merchant_assert_admin(p_actor_id);
BEGIN
  RETURN jsonb_build_object('merchants', public._voucher_merchant_list_json());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_voucher_merchants(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_voucher_merchants(uuid) TO service_role;

-- ── 管理員：找可以指定的帳號（登入過、啟用中）。查詢條件同 admin_api_user_search ─────
CREATE OR REPLACE FUNCTION public.admin_search_voucher_merchant_candidates(
  p_query TEXT,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public._voucher_merchant_assert_admin(p_actor_id);
  v_query TEXT := btrim(COALESCE(p_query, ''));
  v_escaped TEXT;
BEGIN
  IF char_length(v_query) > 100
     OR NOT (v_query ~ '[㐀-鿿豈-﫿]'
             OR char_length(regexp_replace(v_query, '[^A-Za-z0-9]', '', 'g')) >= 2) THEN
    RAISE EXCEPTION 'voucher_merchant_query_too_short';
  END IF;
  v_escaped := replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_');

  RETURN jsonb_build_object('candidates', COALESCE((
    SELECT jsonb_agg(t.row_data ORDER BY t.name, t.id)
    FROM (
      SELECT p.id, p.name,
        jsonb_build_object(
          'profileId', p.id,
          'name', p.name,
          'emailMasked', public.admin_api_mask_email(p.email),
          'pastoralZone', p.pastoral_zone,
          'isMerchant', EXISTS (SELECT 1 FROM public.lightning_quiz_voucher_merchants m WHERE m.profile_id = p.id)
        ) AS row_data
      FROM public.profiles p
      WHERE p.is_active = TRUE
        AND EXISTS (SELECT 1 FROM public.user_identities i WHERE i.profile_id = p.id)
        AND (
          p.name ILIKE '%' || v_escaped || '%'
          OR p.email ILIKE '%' || v_escaped || '%'
          OR EXISTS (
            SELECT 1 FROM public.user_identities i
            WHERE i.profile_id = p.id AND i.email ILIKE '%' || v_escaped || '%'
          )
        )
      ORDER BY p.name, p.id
      LIMIT 10
    ) t
  ), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_search_voucher_merchant_candidates(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_voucher_merchant_candidates(text, uuid) TO service_role;

-- ── 管理員：加入（p_enabled = TRUE）或移除（FALSE）。稽核在同一個交易，沒變動不記 ───
CREATE OR REPLACE FUNCTION public.admin_set_voucher_merchant(
  p_profile_id UUID,
  p_enabled BOOLEAN,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_id UUID := public._voucher_merchant_assert_admin(p_actor_id);
  v_role TEXT := public.role_code((SELECT p.role_id FROM public.profiles p WHERE p.id = v_actor_id));
  v_changed INT;
BEGIN
  IF p_profile_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'voucher_merchant_invalid';
  END IF;

  IF p_enabled THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_profile_id
        AND p.is_active = TRUE
        AND EXISTS (SELECT 1 FROM public.user_identities i WHERE i.profile_id = p.id)
    ) THEN
      RAISE EXCEPTION 'voucher_merchant_not_eligible';
    END IF;
    INSERT INTO public.lightning_quiz_voucher_merchants (profile_id, added_by)
    VALUES (p_profile_id, v_actor_id)
    ON CONFLICT (profile_id) DO NOTHING;
  ELSE
    DELETE FROM public.lightning_quiz_voucher_merchants WHERE profile_id = p_profile_id;
  END IF;
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed > 0 THEN
    PERFORM audit.record(
      'nlc-data',
      CASE WHEN p_enabled THEN 'voucher_merchant.add' ELSE 'voucher_merchant.remove' END,
      'ok', v_actor_id, v_role, 'lightning_quiz_voucher_merchants', p_profile_id, NULL,
      jsonb_build_object('merchant', jsonb_build_object('before', NOT p_enabled, 'after', p_enabled))
    );
  END IF;

  RETURN jsonb_build_object('changed', v_changed > 0, 'merchants', public._voucher_merchant_list_json());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_voucher_merchant(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_voucher_merchant(uuid, boolean, uuid) TO service_role;
