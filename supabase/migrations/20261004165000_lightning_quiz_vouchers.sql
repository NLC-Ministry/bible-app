-- ============================================================================
-- 20261004165000_lightning_quiz_vouchers.sql  —  #445 雲柱測驗英雄榜：克勞斯 100 元抵用券
--
-- 管理員公布某週前三名（#429，lightning_quiz_week_rankings）時，伺服器依公布的名單
-- 自動發券：每一天的每個名次各一張（同一人得獎多天就拿多張），面額 100 元，
-- 公布當天起 30 天內有效（含公布當天）。
--
-- 1. lightning_quiz_vouchers：一張券一列。同一週同一天同一人只會有一張。
-- 2. _lightning_quiz_sync_week_vouchers：依某週目前公布的名單發券／作廢。
--    重新公布時，被排除、還沒兌換的券作廢；已兌換的保留；又回到名單的人券恢復。
--    撤下公布（只改 revoked_at）不影響券。由 lightning_quiz_week_rankings 的
--    trigger 呼叫，所以不用改 admin_publish_lightning_quiz_week_ranking。
-- 3. get_my_lightning_quiz_vouchers／redeem_my_lightning_quiz_voucher：會友看自己的券、
--    在店裡由本人按「確認兌換」。只碰呼叫者自己的券（p_actor_id 由 nlc-data 注入）。
-- 4. admin_list_lightning_quiz_vouchers／admin_set_lightning_quiz_voucher_redeemed：
--    後台兌換清單、手動標記兌換或撤銷誤按的兌換。
-- 5. 補發：這支 migration 上線前已經公布（且沒撤下）的週，照名單補發一次。
--
-- 全部是新增，舊版程式不會呼叫，不需要 forceUpdateBuiltBefore。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lightning_quiz_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL REFERENCES public.lightning_quiz_week_rankings(week_start) ON DELETE CASCADE,
  rise_date DATE NOT NULL,
  rank SMALLINT NOT NULL CHECK (rank BETWEEN 1 AND 3),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 公布當時的姓名／牧區／秒數（跟 entries 一樣是固定紀錄）
  name TEXT NOT NULL DEFAULT '',
  pastoral_zone TEXT NOT NULL DEFAULT '',
  elapsed_ms BIGINT,
  code TEXT NOT NULL UNIQUE,
  amount INT NOT NULL DEFAULT 100,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_on DATE NOT NULL,
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  redeemed_via TEXT CHECK (redeemed_via IN ('self', 'admin')),
  voided_at TIMESTAMPTZ,
  UNIQUE (week_start, rise_date, user_id)
);
CREATE INDEX IF NOT EXISTS lightning_quiz_vouchers_user_idx ON public.lightning_quiz_vouchers (user_id);
ALTER TABLE public.lightning_quiz_vouchers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lightning_quiz_vouchers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.lightning_quiz_vouchers TO service_role;

-- ── 兌換碼：6 碼，不含容易看錯的 0/O、1/I/L ────────────────────────────────
-- 只是給店員對照用的識別碼，兌換是用本人帳號按，不靠兌換碼保密。
CREATE OR REPLACE FUNCTION public._lightning_quiz_voucher_code()
RETURNS TEXT
LANGUAGE sql VOLATILE SET search_path = pg_catalog, public
AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::INT, 1), '')
  FROM generate_series(1, 6);
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_voucher_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_voucher_code() TO service_role;

-- ── 一張券回傳給前端的樣子 ──────────────────────────────────────────────────
-- status：available（可使用）／redeemed（已兌換）／expired（已過期）／void（已作廢）
CREATE OR REPLACE FUNCTION public._lightning_quiz_voucher_json(v public.lightning_quiz_vouchers, p_today DATE)
RETURNS JSONB
LANGUAGE sql STABLE SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', v.id,
    'code', v.code,
    'amount', v.amount,
    'weekStart', v.week_start::TEXT,
    'riseDate', v.rise_date::TEXT,
    'rank', v.rank,
    'name', v.name,
    'pastoralZone', v.pastoral_zone,
    'elapsedMs', v.elapsed_ms,
    'issuedAt', v.issued_at,
    'expiresOn', v.expires_on::TEXT,
    'redeemedAt', v.redeemed_at,
    'redeemedVia', v.redeemed_via,
    'status', CASE
      WHEN v.voided_at IS NOT NULL THEN 'void'
      WHEN v.redeemed_at IS NOT NULL THEN 'redeemed'
      WHEN v.expires_on < p_today THEN 'expired'
      ELSE 'available'
    END
  );
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_voucher_json(public.lightning_quiz_vouchers, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_voucher_json(public.lightning_quiz_vouchers, date) TO service_role;

-- ── 依某週目前公布的名單發券／作廢 ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._lightning_quiz_sync_week_vouchers(p_week_start DATE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  rk        public.lightning_quiz_week_rankings%ROWTYPE;
  w         RECORD;
  today_tw  DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  tries     INT;
BEGIN
  SELECT * INTO rk FROM public.lightning_quiz_week_rankings WHERE week_start = p_week_start;
  IF NOT FOUND THEN RETURN; END IF;

  -- 不在名單上、還沒兌換的券作廢（已兌換的保留）。
  UPDATE public.lightning_quiz_vouchers v
  SET voided_at = NOW()
  WHERE v.week_start = p_week_start
    AND v.redeemed_at IS NULL
    AND v.voided_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(rk.entries) e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e->'winners', '[]'::jsonb)) x
      WHERE (e->>'riseDate')::DATE = v.rise_date
        AND (x->>'userId')::UUID = v.user_id
    );

  FOR w IN
    SELECT (e->>'riseDate')::DATE AS rise_date,
           (x->>'userId')::UUID AS user_id,
           (x->>'rank')::SMALLINT AS rank,
           COALESCE(x->>'name', '') AS name,
           COALESCE(x->>'pastoralZone', '') AS pastoral_zone,
           (x->>'elapsedMs')::BIGINT AS elapsed_ms
    FROM jsonb_array_elements(rk.entries) e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e->'winners', '[]'::jsonb)) x
    WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (x->>'userId')::UUID)
  LOOP
    -- 已經有券：更新名次與固定紀錄；之前被作廢、又回到名單的恢復（期限不變）。
    UPDATE public.lightning_quiz_vouchers
    SET rank = w.rank,
        name = w.name,
        pastoral_zone = w.pastoral_zone,
        elapsed_ms = w.elapsed_ms,
        voided_at = NULL
    WHERE week_start = p_week_start AND rise_date = w.rise_date AND user_id = w.user_id;
    IF FOUND THEN CONTINUE; END IF;

    tries := 0;
    LOOP
      BEGIN
        INSERT INTO public.lightning_quiz_vouchers
          (week_start, rise_date, rank, user_id, name, pastoral_zone, elapsed_ms, code, expires_on)
        VALUES
          (p_week_start, w.rise_date, w.rank, w.user_id, w.name, w.pastoral_zone, w.elapsed_ms,
           public._lightning_quiz_voucher_code(), today_tw + 29);
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- 兌換碼撞到別張就換一組再試
        tries := tries + 1;
        IF tries >= 10 THEN RAISE; END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_sync_week_vouchers(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_sync_week_vouchers(date) TO service_role;

-- 公布／重新公布（寫入 entries）時發券；撤下只改 revoked_at，不會觸發。
CREATE OR REPLACE FUNCTION public._lightning_quiz_week_rankings_sync_vouchers()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public._lightning_quiz_sync_week_vouchers(NEW.week_start);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._lightning_quiz_week_rankings_sync_vouchers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lightning_quiz_week_rankings_sync_vouchers() TO service_role;

DROP TRIGGER IF EXISTS lightning_quiz_week_rankings_sync_vouchers ON public.lightning_quiz_week_rankings;
CREATE TRIGGER lightning_quiz_week_rankings_sync_vouchers
  AFTER INSERT OR UPDATE OF entries ON public.lightning_quiz_week_rankings
  FOR EACH ROW EXECUTE FUNCTION public._lightning_quiz_week_rankings_sync_vouchers();

-- ── 會友：我的兌換券（不含已作廢的）─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_lightning_quiz_vouchers(p_actor_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
BEGIN
  RETURN jsonb_build_object(
    'today', today_tw::TEXT,
    'vouchers', COALESCE((
      SELECT jsonb_agg(public._lightning_quiz_voucher_json(v, today_tw) ORDER BY v.rise_date DESC, v.rank)
      FROM public.lightning_quiz_vouchers v
      WHERE v.user_id = actor_id AND v.voided_at IS NULL
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_lightning_quiz_vouchers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_lightning_quiz_vouchers(uuid) TO authenticated, service_role;

-- ── 會友：在店裡由本人按「確認兌換」──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.redeem_my_lightning_quiz_voucher(
  p_voucher_id UUID,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v        public.lightning_quiz_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.lightning_quiz_vouchers
  WHERE id = p_voucher_id AND user_id = actor_id
  FOR UPDATE;
  IF NOT FOUND OR v.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'lightning_quiz_voucher_not_found';
  END IF;
  IF v.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'lightning_quiz_voucher_already_redeemed';
  END IF;
  IF v.expires_on < today_tw THEN
    RAISE EXCEPTION 'lightning_quiz_voucher_expired';
  END IF;

  UPDATE public.lightning_quiz_vouchers
  SET redeemed_at = NOW(), redeemed_by = actor_id, redeemed_via = 'self'
  WHERE id = v.id
  RETURNING * INTO v;

  RETURN public._lightning_quiz_voucher_json(v, today_tw);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_my_lightning_quiz_voucher(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_my_lightning_quiz_voucher(uuid, uuid) TO authenticated, service_role;

-- ── 後台：兌換清單（p_week_start 為 NULL＝全部週）──────────────────────────
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
          || jsonb_build_object('redeemedByName', COALESCE(rb.name, ''))
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

-- ── 後台：手動標記兌換（p_redeemed = TRUE）或撤銷誤按的兌換（FALSE）───────
-- 管理員標記不受期限限制（例如店家事後才回報）；已作廢的券不能標記。
CREATE OR REPLACE FUNCTION public.admin_set_lightning_quiz_voucher_redeemed(
  p_voucher_id UUID,
  p_redeemed BOOLEAN,
  p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_id UUID := public.resolve_quiz_actor(p_actor_id);
  today_tw DATE := (NOW() AT TIME ZONE 'Asia/Taipei')::DATE;
  v        public.lightning_quiz_vouchers%ROWTYPE;
BEGIN
  IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN
    RAISE EXCEPTION 'lightning_quiz_admin_required';
  END IF;
  IF p_redeemed IS NULL THEN RAISE EXCEPTION 'lightning_quiz_voucher_invalid'; END IF;

  SELECT * INTO v FROM public.lightning_quiz_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lightning_quiz_voucher_not_found'; END IF;
  IF v.voided_at IS NOT NULL THEN RAISE EXCEPTION 'lightning_quiz_voucher_void'; END IF;

  IF p_redeemed THEN
    IF v.redeemed_at IS NOT NULL THEN RAISE EXCEPTION 'lightning_quiz_voucher_already_redeemed'; END IF;
    UPDATE public.lightning_quiz_vouchers
    SET redeemed_at = NOW(), redeemed_by = actor_id, redeemed_via = 'admin'
    WHERE id = v.id
    RETURNING * INTO v;
  ELSE
    UPDATE public.lightning_quiz_vouchers
    SET redeemed_at = NULL, redeemed_by = NULL, redeemed_via = NULL
    WHERE id = v.id
    RETURNING * INTO v;
  END IF;

  RETURN public._lightning_quiz_voucher_json(v, today_tw);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_lightning_quiz_voucher_redeemed(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_lightning_quiz_voucher_redeemed(uuid, boolean, uuid) TO authenticated, service_role;

-- ── 補發：已經公布（且沒撤下）的週 ──────────────────────────────────────────
DO $$
DECLARE
  wk DATE;
BEGIN
  FOR wk IN SELECT week_start FROM public.lightning_quiz_week_rankings WHERE revoked_at IS NULL LOOP
    PERFORM public._lightning_quiz_sync_week_vouchers(wk);
  END LOOP;
END;
$$;
