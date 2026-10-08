-- #412 打卡截止寬限期：每個計畫自己設定天數，伺服器觸發器強制。
--
-- 以前「計畫截止後不能打卡」只靠前端擋（isPlanExpired）；舊版 App、離線佇列補送、
-- 直接打 nlc-data 都能在截止後寫入 reading_logs。這裡把規則放進既有的 BEFORE 觸發器，
-- 所有寫入路徑自動適用（不需要新 RPC，也不需要 forceUpdateBuiltBefore）。
--
-- 規則（固定日期計畫才適用；彈性計畫沒有截止）：
--   台北今天 > global_plans.end_date + grace_days → 新增、修改、取消打卡一律拒絕
--   （'reading_log_plan_closed'）。用伺服器時間判斷，不信任前端送來的 read_at。
--   grace_days 預設 0 ＝ 維持「截止日隔天起不能打卡」。
--
-- 不擋的刪除：連帶刪除（pg_trigger_depth() > 1）——退出計畫／刪除計畫／刪帳號的
-- ON DELETE CASCADE、cleanup_removed_church_campaign_stages 等系統清理。
-- 之後若有一次性修資料的 migration 要直接改已結算計畫的 reading_logs，
-- 在該 migration 裡暫時 DISABLE 這個觸發器。
--
-- 觸發器函式以 0137 改寫後的版本為底（is_campaign_stage_kind），階段開放前的檢查不變。

BEGIN;

ALTER TABLE public.global_plans
  ADD COLUMN IF NOT EXISTS grace_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.global_plans
  DROP CONSTRAINT IF EXISTS global_plans_grace_days_range;
ALTER TABLE public.global_plans
  ADD CONSTRAINT global_plans_grace_days_range CHECK (grace_days BETWEEN 0 AND 30);

COMMENT ON COLUMN public.global_plans.grace_days IS
  '#412 固定日期計畫截止後仍可打卡（新增／修改／取消）的天數；0 = 截止日隔天起不能打卡。';

CREATE OR REPLACE FUNCTION public.enforce_reading_log_stage_progress_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $enforce_reading_log_stage_progress_open$
DECLARE
  target_plan public.global_plans%ROWTYPE;
  enrollment_user_id UUID;
  taipei_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::DATE;
BEGIN
  -- 取消打卡，以及修改到別的計畫時的「原本那筆」：結算後的紀錄固定。
  IF TG_OP IN ('DELETE', 'UPDATE') AND OLD.plan_id IS NOT NULL THEN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;

    SELECT global_plan.* INTO target_plan
    FROM public.reading_plans enrollment
    JOIN public.global_plans global_plan ON global_plan.id = enrollment.global_plan_id
    WHERE enrollment.id = OLD.plan_id;

    IF FOUND
       AND target_plan.is_fixed
       AND target_plan.end_date IS NOT NULL
       AND taipei_today > target_plan.end_date + target_plan.grace_days THEN
      RAISE EXCEPTION 'reading_log_plan_closed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.plan_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT enrollment.user_id INTO enrollment_user_id
  FROM public.reading_plans enrollment
  WHERE enrollment.id = NEW.plan_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF enrollment_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'reading_log_plan_owner_mismatch' USING ERRCODE = 'P0001';
  END IF;

  SELECT global_plan.* INTO target_plan
  FROM public.reading_plans enrollment
  JOIN public.global_plans global_plan ON global_plan.id = enrollment.global_plan_id
  WHERE enrollment.id = NEW.plan_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF target_plan.is_fixed
     AND target_plan.end_date IS NOT NULL
     AND taipei_today > target_plan.end_date + target_plan.grace_days THEN
    RAISE EXCEPTION 'reading_log_plan_closed' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.is_campaign_stage_kind(target_plan.plan_kind) THEN
    RETURN NEW;
  END IF;

  IF target_plan.is_hidden
     OR taipei_today < target_plan.start_date THEN
    RAISE EXCEPTION 'campaign_stage_progress_not_open' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$enforce_reading_log_stage_progress_open$;

REVOKE ALL ON FUNCTION public.enforce_reading_log_stage_progress_open() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_reading_log_stage_progress_open() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reading_log_stage_progress_open ON public.reading_logs;
CREATE TRIGGER trg_reading_log_stage_progress_open
  BEFORE INSERT OR UPDATE OF plan_id, user_id, book, chapter, round, read_at OR DELETE
  ON public.reading_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_reading_log_stage_progress_open();

COMMIT;
