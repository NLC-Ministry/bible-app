-- ============================================================================
-- 20261101085321_admin_merge_profiles.sql  —  #655
--
-- 會友換登入方式（原本手機、後來 Email）時，Logto 給的是另一個 sub，nlc-session 會開出
-- 一個新的空帳號；會友以為資料不見了，或在新帳號從頭再讀。這支提供維運用的合併：
--
--   admin_merge_profiles(來源, 目標, p_dry_run DEFAULT TRUE)
--     把來源帳號（新）的資料併進目標帳號（舊），只給 service_role，由維護者在 SQL Editor 執行。
--     p_dry_run = TRUE（預設）：整套照做一遍後回滾，只回報每張表搬幾筆、刪幾筆衝突。
--
--   規則：
--     1. reading_plans：目標沒有的計畫整筆改到目標名下；兩邊都有同一個全教會計畫時，
--        來源的打卡搬進目標那筆，current_round 取較大的，來源那筆刪掉。
--     2. reading_logs：同一計畫（或都不屬於計畫）的同一書卷、章、遍數只留一筆，
--        保留較早的 read_at（重讀的章節算同一遍，不會多算）。
--     3. 其他所有參照 profiles 的外鍵欄位（從 pg_constraint 動態列出，含 user_identities、
--        reading_team_members、小測驗、雲柱、筆記、稽核欄位…）：逐列改指目標；撞到唯一鍵時，
--        ON DELETE CASCADE 的欄位刪掉來源那筆（目標的留著），其他欄位留在來源帳號不動。
--     4. user_identities 先全部 is_primary = FALSE 再搬：之後用 Email 登入也會進目標帳號。
--     5. 來源帳號不刪：清空 nlc_member_id（UNIQUE，下次登入 nlc-session 才寫得進目標）、
--        email、phone（目標沒有時先補給目標），設 is_active = FALSE。確認沒問題後再手動刪。
--     6. 每次合併記一筆 profile_merges：回報內容＋所有被刪掉的列（JSON），可以查也可以人工還原。
--
--   已結束的階段有保護觸發器：交易內暫時停用 trg_reading_plans_progress_transition
--   （計畫擁有者不可改）與 trg_reading_log_stage_progress_open（結算後的打卡固定），
--   團隊用既有的 reading_team.allow_ended_edit 放行；結束前全部恢復。停用觸發器會短暫鎖住
--   reading_plans／reading_logs 的寫入（合併本身不到一秒）。
--
-- 只新增函式與資料表，App 不會呼叫：不需要 forceUpdateBuiltBefore，也不用部署 Edge Function。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profile_merges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_profile_id UUID NOT NULL,   -- 不設外鍵：之後刪掉來源帳號，紀錄仍在
  target_profile_id UUID NOT NULL,
  merged_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  report            JSONB NOT NULL,
  removed_rows      JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_merges_source ON public.profile_merges(source_profile_id);
ALTER TABLE public.profile_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profile_merges FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profile_merges TO service_role;

CREATE OR REPLACE FUNCTION public.admin_merge_profiles(
  p_source_profile_id UUID,
  p_target_profile_id UUID,
  p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $admin_merge_profiles$
DECLARE
  source_profile public.profiles%ROWTYPE;
  target_profile public.profiles%ROWTYPE;
  plan_row RECORD;
  log_row RECORD;
  target_log RECORD;
  fk RECORD;
  target_plan_id UUID;
  row_ids TID[];
  row_id TID;
  removed_row JSONB;
  removed JSONB := '[]'::jsonb;
  other_tables JSONB := '[]'::jsonb;
  plans_moved INTEGER := 0;
  plans_merged INTEGER := 0;
  logs_moved INTEGER := 0;
  logs_dropped INTEGER := 0;
  logs_earlier INTEGER := 0;
  t_moved INTEGER;
  t_deleted INTEGER;
  t_kept INTEGER;
  previous_team_guard TEXT;
  report JSONB;
BEGIN
  IF p_source_profile_id IS NOT NULL AND p_source_profile_id = p_target_profile_id THEN
    RAISE EXCEPTION 'profile_merge_same_profile' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO source_profile FROM public.profiles WHERE id = p_source_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_merge_profile_not_found' USING ERRCODE = 'P0001', DETAIL = 'source';
  END IF;
  SELECT * INTO target_profile FROM public.profiles WHERE id = p_target_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_merge_profile_not_found' USING ERRCODE = 'P0001', DETAIL = 'target';
  END IF;

  -- 來源已經併過，或目標本身是被併掉的帳號
  IF EXISTS (SELECT 1 FROM public.profile_merges m
             WHERE m.source_profile_id IN (p_source_profile_id, p_target_profile_id)) THEN
    RAISE EXCEPTION 'profile_merge_already_merged' USING ERRCODE = 'P0001';
  END IF;

  -- 預覽也整套照做，最後丟 PM001 讓這個區塊回滾；區域變數（回報）不受回滾影響
  BEGIN
    ALTER TABLE public.reading_plans DISABLE TRIGGER trg_reading_plans_progress_transition;
    ALTER TABLE public.reading_logs DISABLE TRIGGER trg_reading_log_stage_progress_open;
    previous_team_guard := current_setting('reading_team.allow_ended_edit', true);
    PERFORM set_config('reading_team.allow_ended_edit', 'on', true);

    -- 1. 計畫與計畫內的打卡
    FOR plan_row IN
      SELECT p.id, p.global_plan_id, p.current_round
      FROM public.reading_plans p
      WHERE p.user_id = p_source_profile_id
      ORDER BY p.created_at, p.id
    LOOP
      target_plan_id := NULL;
      IF plan_row.global_plan_id IS NOT NULL THEN
        SELECT p.id INTO target_plan_id
        FROM public.reading_plans p
        WHERE p.user_id = p_target_profile_id AND p.global_plan_id = plan_row.global_plan_id;
      END IF;

      IF target_plan_id IS NULL THEN
        UPDATE public.reading_plans SET user_id = p_target_profile_id WHERE id = plan_row.id;
        UPDATE public.reading_logs SET user_id = p_target_profile_id WHERE plan_id = plan_row.id;
        GET DIAGNOSTICS t_moved = ROW_COUNT;
        logs_moved := logs_moved + t_moved;
        plans_moved := plans_moved + 1;
        CONTINUE;
      END IF;

      FOR log_row IN
        SELECT l.id, l.book, l.chapter, l.round, l.read_at
        FROM public.reading_logs l
        WHERE l.plan_id = plan_row.id
      LOOP
        SELECT l.id, l.read_at INTO target_log
        FROM public.reading_logs l
        WHERE l.user_id = p_target_profile_id AND l.plan_id = target_plan_id
          AND l.book = log_row.book AND l.chapter = log_row.chapter AND l.round = log_row.round;
        IF FOUND THEN
          IF log_row.read_at < target_log.read_at THEN
            UPDATE public.reading_logs SET read_at = log_row.read_at WHERE id = target_log.id;
            logs_earlier := logs_earlier + 1;
          END IF;
          DELETE FROM public.reading_logs l WHERE l.id = log_row.id RETURNING to_jsonb(l) INTO removed_row;
          removed := removed || jsonb_build_object('table', 'public.reading_logs', 'row', removed_row);
          logs_dropped := logs_dropped + 1;
        ELSE
          UPDATE public.reading_logs SET user_id = p_target_profile_id, plan_id = target_plan_id WHERE id = log_row.id;
          logs_moved := logs_moved + 1;
        END IF;
      END LOOP;

      UPDATE public.reading_plans
      SET current_round = GREATEST(current_round, plan_row.current_round)
      WHERE id = target_plan_id;
      DELETE FROM public.reading_plans p WHERE p.id = plan_row.id RETURNING to_jsonb(p) INTO removed_row;
      removed := removed || jsonb_build_object('table', 'public.reading_plans', 'row', removed_row);
      plans_merged := plans_merged + 1;
    END LOOP;

    -- 2. 不屬於任何計畫的打卡
    FOR log_row IN
      SELECT l.id, l.book, l.chapter, l.round, l.read_at
      FROM public.reading_logs l
      WHERE l.user_id = p_source_profile_id AND l.plan_id IS NULL
    LOOP
      SELECT l.id, l.read_at INTO target_log
      FROM public.reading_logs l
      WHERE l.user_id = p_target_profile_id AND l.plan_id IS NULL
        AND l.book = log_row.book AND l.chapter = log_row.chapter AND l.round = log_row.round;
      IF FOUND THEN
        IF log_row.read_at < target_log.read_at THEN
          UPDATE public.reading_logs SET read_at = log_row.read_at WHERE id = target_log.id;
          logs_earlier := logs_earlier + 1;
        END IF;
        DELETE FROM public.reading_logs l WHERE l.id = log_row.id RETURNING to_jsonb(l) INTO removed_row;
        removed := removed || jsonb_build_object('table', 'public.reading_logs', 'row', removed_row);
        logs_dropped := logs_dropped + 1;
      ELSE
        UPDATE public.reading_logs SET user_id = p_target_profile_id WHERE id = log_row.id;
        logs_moved := logs_moved + 1;
      END IF;
    END LOOP;

    -- 3. 每個帳號只能有一個主要身分：來源的身分搬過去都當次要
    UPDATE public.user_identities SET is_primary = FALSE WHERE profile_id = p_source_profile_id;

    -- 4. 其他參照 profiles 的外鍵欄位：逐列改指目標，撞到唯一鍵再決定
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col, c.confdeltype AS on_delete
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.profiles'::regclass
        AND cardinality(c.conkey) = 1
        AND NOT (c.conrelid = 'public.reading_plans'::regclass AND a.attname = 'user_id')
        AND NOT (c.conrelid = 'public.reading_logs'::regclass AND a.attname = 'user_id')
      ORDER BY c.conrelid::regclass::text, a.attname
    LOOP
      EXECUTE format('SELECT array_agg(ctid) FROM %s WHERE %I = $1', fk.tbl, fk.col)
        INTO row_ids USING p_source_profile_id;
      CONTINUE WHEN row_ids IS NULL;

      t_moved := 0;
      t_deleted := 0;
      t_kept := 0;
      FOREACH row_id IN ARRAY row_ids LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col)
            USING p_target_profile_id, row_id;
          t_moved := t_moved + 1;
        EXCEPTION WHEN unique_violation THEN
          IF fk.on_delete = 'c' THEN
            EXECUTE format('DELETE FROM %s AS t WHERE t.ctid = $1 RETURNING to_jsonb(t)', fk.tbl)
              INTO removed_row USING row_id;
            removed := removed || jsonb_build_object('table', fk.tbl::text, 'row', removed_row);
            t_deleted := t_deleted + 1;
          ELSE
            t_kept := t_kept + 1;
          END IF;
        END;
      END LOOP;

      other_tables := other_tables || jsonb_build_object(
        'table', fk.tbl::text, 'column', fk.col,
        'moved', t_moved, 'conflictsDeleted', t_deleted, 'keptOnSource', t_kept
      );
    END LOOP;

    -- 5. 帳號本身：目標補上缺的聯絡資料，來源停用
    UPDATE public.profiles
    SET email = CASE WHEN COALESCE(email, '') = '' THEN source_profile.email ELSE email END,
        phone = CASE WHEN COALESCE(phone, '') = '' THEN source_profile.phone ELSE phone END,
        updated_at = now()
    WHERE id = p_target_profile_id;
    UPDATE public.profiles
    SET nlc_member_id = NULL, email = NULL, phone = NULL, is_active = FALSE, updated_at = now()
    WHERE id = p_source_profile_id;

    ALTER TABLE public.reading_plans ENABLE TRIGGER trg_reading_plans_progress_transition;
    ALTER TABLE public.reading_logs ENABLE TRIGGER trg_reading_log_stage_progress_open;
    PERFORM set_config('reading_team.allow_ended_edit', COALESCE(previous_team_guard, ''), true);

    report := jsonb_build_object(
      'dryRun', p_dry_run,
      'source', jsonb_build_object('id', source_profile.id, 'name', source_profile.name, 'createdAt', source_profile.created_at),
      'target', jsonb_build_object('id', target_profile.id, 'name', target_profile.name, 'createdAt', target_profile.created_at),
      'readingPlans', jsonb_build_object('moved', plans_moved, 'mergedIntoExisting', plans_merged),
      'readingLogs', jsonb_build_object('moved', logs_moved, 'duplicatesDropped', logs_dropped, 'earlierReadAtKept', logs_earlier),
      'otherTables', other_tables,
      'removedRows', jsonb_array_length(removed)
    );

    INSERT INTO public.profile_merges (source_profile_id, target_profile_id, report, removed_rows)
    VALUES (p_source_profile_id, p_target_profile_id, report, removed);

    IF p_dry_run THEN
      RAISE EXCEPTION 'profile_merge_dry_run' USING ERRCODE = 'PM001';
    END IF;
  EXCEPTION WHEN SQLSTATE 'PM001' THEN
    NULL;
  END;

  RETURN report;
END;
$admin_merge_profiles$;

REVOKE ALL ON FUNCTION public.admin_merge_profiles(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_profiles(UUID, UUID, BOOLEAN) TO service_role;
