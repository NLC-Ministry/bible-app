-- ============================================================================
-- 20261026142242_lightning_quiz_vouchers_overview.sql  —  #614 雲柱測驗後台「得獎與兌換」總覽
--
-- 後台跨週追蹤英雄榜兌換券（#445）、統計得獎次數、改已發出的券的期限。
--
-- 1. admin_set_lightning_quiz_vouchers_expiry（新）：一次改多張券的有效期限。只改
--    未作廢、未兌換的（可使用／已過期）；新日期要在今天（台灣日期）～一年內。
--    選到的券在這期間被兌換或作廢就跳過，回傳更新與跳過的張數。已過期的券延長後，
--    狀態（_lightning_quiz_voucher_json 依日期算）自動變回可使用。
--    重新公布名單時 _lightning_quiz_sync_week_vouchers 不碰 expires_on，改過的期限會保留。
-- 2. admin_list_lightning_quiz_vouchers：多回傳 userId，後台依人統計得獎次數用（同名
--    的人不會被算成同一個）。只加在這支；_lightning_quiz_voucher_json 會友端也在用，不動。
-- 3. admin_get_lightning_quiz_week_ranking：每位候選人多回傳 priorWins＝這週以前
--    未作廢的券數，公布前三名時給人工排除參考。_lightning_quiz_week_candidates 也被
--    公布函式拿來寫快照（entries），所以加在這支的輸出，不加進 candidates 本身。
--
-- 全部是新增函式／新增欄位，舊版程式不受影響，不需要 forceUpdateBuiltBefore。
-- ============================================================================

-- ── 後台：改多張券的有效期限 ────────────────────────────────────────────────
-- 正式站經 nlc-data（service_role）呼叫，client 不直接呼叫，所以只給 service_role。
CREATE OR REPLACE FUNCTION public.admin_set_lightning_quiz_vouchers_expiry(
  p_voucher_ids UUID[],
  p_expires_on DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id  UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  wanted    UUID[];
  updated_n INT;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_expires_on IS NULL OR p_expires_on < today_tw OR p_expires_on > today_tw + 365 THEN
    RAISE EXCEPTION 'lightning_quiz_voucher_invalid_expiry';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT t.id), ARRAY[]::UUID[]) INTO wanted
  FROM unnest(p_voucher_ids) AS t(id)
  WHERE t.id IS NOT NULL;
  IF cardinality(wanted) = 0 OR cardinality(wanted) > 2000 THEN
    RAISE EXCEPTION 'lightning_quiz_voucher_invalid';
  END IF;

  UPDATE public.lightning_quiz_vouchers
  SET expires_on = p_expires_on
  WHERE id = ANY(wanted)
    AND voided_at IS NULL
    AND redeemed_at IS NULL;
  GET DIAGNOSTICS updated_n = ROW_COUNT;

  RETURN jsonb_build_object(
    'expiresOn', p_expires_on::TEXT,
    'updated', updated_n,
    'skipped', cardinality(wanted) - updated_n
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_vouchers_expiry(uuid[], date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_vouchers_expiry(uuid[], date, uuid) TO service_role;

-- ── 後台：兌換清單多回傳 userId（p_week_start 為 NULL＝全部週）────────────────
CREATE OR REPLACE FUNCTION public.admin_list_lightning_quiz_vouchers(
  p_week_start DATE DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;

  RETURN jsonb_build_object(
    'today', today_tw::TEXT,
    'vouchers', COALESCE((
      SELECT jsonb_agg(
        public._lightning_quiz_voucher_json(v, today_tw)
          || jsonb_build_object('redeemedByName', COALESCE(rb.name, ''), 'userId', v.user_id)
        ORDER BY v.rise_date, v.rank)
      FROM public.lightning_quiz_vouchers v
      LEFT JOIN public.profiles rb ON rb.id = v.redeemed_by
      WHERE p_week_start IS NULL OR v.week_start = date_trunc('week', p_week_start)::DATE
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_lightning_quiz_vouchers(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_lightning_quiz_vouchers(date, uuid) TO authenticated, service_role;

-- ── 後台：候選名單多回傳 priorWins（這週以前未作廢的券數）──────────────────
CREATE OR REPLACE FUNCTION public.admin_get_lightning_quiz_week_ranking(
  p_week_start DATE,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id   UUID := public.resolve_quiz_actor(p_actor_id);
  v_week     DATE;
  days_j     JSONB;
  r          public.lightning_quiz_week_rankings%ROWTYPE;
  today_tw   DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_week_start IS NULL THEN RAISE EXCEPTION 'lightning_quiz_week_required'; END IF;
  v_week := date_trunc('week', p_week_start)::DATE;
  days_j := public._lightning_quiz_week_candidates(v_week);

  SELECT COALESCE(jsonb_agg(
    d || jsonb_build_object('candidates', COALESCE((
      SELECT jsonb_agg(c || jsonb_build_object('priorWins', (
        SELECT count(*)
        FROM public.lightning_quiz_vouchers v
        WHERE v.user_id = (c->>'userId')::UUID
          AND v.week_start < v_week
          AND v.voided_at IS NULL
      )) ORDER BY c_ord)
      FROM jsonb_array_elements(d->'candidates') WITH ORDINALITY AS ct(c, c_ord)
    ), '[]'::jsonb))
    ORDER BY d_ord), '[]'::jsonb)
  INTO days_j
  FROM jsonb_array_elements(days_j) WITH ORDINALITY AS dt(d, d_ord);

  SELECT * INTO r FROM public.lightning_quiz_week_rankings WHERE week_start = v_week;

  RETURN jsonb_build_object(
    'weekStart', v_week::TEXT,
    'weekEnd', (v_week + 6)::TEXT,
    'allEnded', jsonb_array_length(days_j) > 0
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(days_j) d WHERE NOT (d->>'ended')::BOOLEAN),
    'days', days_j,
    'publication', CASE WHEN r.week_start IS NULL THEN NULL ELSE jsonb_build_object(
      'entries', r.entries,
      'excluded', r.excluded,
      'displayDays', r.display_days,
      'displayUntil', r.display_until::TEXT,
      'publishedAt', r.published_at,
      'revoked', r.revoked_at IS NOT NULL,
      'showing', r.revoked_at IS NULL AND r.display_until >= today_tw
    ) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_week_ranking(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lightning_quiz_week_ranking(date, uuid) TO authenticated, service_role;
