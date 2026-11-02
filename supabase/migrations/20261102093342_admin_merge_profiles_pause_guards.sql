-- ============================================================================
-- 20261102093342_admin_merge_profiles_pause_guards.sql  —  #660
--
-- #655 的 admin_merge_profiles 只停用了打卡／計畫的兩個觸發器、用 GUC 放行團隊，
-- 正式站預覽時被 care_reminders 的 trg_care_reminders_transition（送出後收件人不能改）擋下。
-- 參照 profiles 的表上還有十多個「修改前檢查」的觸發器（小測驗審核鎖定、已結束階段的
-- 團隊／小家、計畫個人規則…），被併掉的帳號只要有這些資料就合併不了。
--
-- 改為：合併開始時，把會改到的表（參照 profiles 或 reading_plans 的表，加上 profiles 本身）
-- 上所有啟用中的使用者 BEFORE UPDATE／DELETE 觸發器動態列出來暫停，結束前照原樣恢復；
-- AFTER 觸發器（例如 trg_audit_reading_team_members 稽核）照常執行。
-- 不再需要 reading_team.allow_ended_edit。改指目標時撞到 CHECK（例如提醒變成寄給自己）
-- 也和非 CASCADE 的唯一鍵衝突一樣，留在來源帳號不動。
--
-- 使用注意：會對更多表 ALTER TABLE … DISABLE TRIGGER，呼叫的那句 SQL 若同時讀了這些表
-- 會報 55006（資料不變）；先查好 ID，單獨一句呼叫。
--
-- 函式簽名、回報格式不變，App 不會呼叫：不需要 forceUpdateBuiltBefore，也不用部署 Edge Function。
-- ============================================================================

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
  guard RECORD;
  paused JSONB := '[]'::jsonb;
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
    -- 0. 暫停會改到的表上的「修改前檢查」：BEFORE UPDATE／DELETE、使用者定義、目前啟用中
    FOR guard IN
      SELECT t.tgrelid::regclass AS tbl, t.tgname
      FROM pg_catalog.pg_trigger t
      WHERE NOT t.tgisinternal
        AND t.tgenabled = 'O'
        AND (t.tgtype & 2) <> 0            -- BEFORE
        AND (t.tgtype & (8 | 16)) <> 0     -- DELETE 或 UPDATE
        AND (t.tgrelid = 'public.profiles'::regclass
             OR t.tgrelid IN (SELECT c.conrelid FROM pg_catalog.pg_constraint c
                              WHERE c.contype = 'f'
                                AND c.confrelid IN ('public.profiles'::regclass, 'public.reading_plans'::regclass)))
      ORDER BY t.tgrelid::regclass::text, t.tgname
    LOOP
      EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', guard.tbl, guard.tgname);
      paused := paused || jsonb_build_object('table', guard.tbl::text, 'trigger', guard.tgname);
    END LOOP;

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
        EXCEPTION
          WHEN check_violation THEN
            t_kept := t_kept + 1;
          WHEN unique_violation THEN
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

    FOR guard IN SELECT g->>'table' AS tbl, g->>'trigger' AS tgname FROM jsonb_array_elements(paused) g LOOP
      EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', guard.tbl, guard.tgname);
    END LOOP;

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
