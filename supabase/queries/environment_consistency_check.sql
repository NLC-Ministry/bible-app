-- ============================================================================
-- environment_consistency_check.sql  —  只讀，不修改任何資料
--
-- 用途：在正式環境和 staging 各跑一次，比對兩份輸出，就知道兩邊的 schema、
-- 權限、RLS、Storage 設定有沒有不一致（見 issue #266、docs/staging.md）。
-- migration 都是手動貼的，時間一久很容易漏貼或貼錯，這支是用來抓這種差異。
--
-- 輸出三欄：section（類別）、object（物件）、detail（內容）。
-- 排序固定，而且不含 OID 這類每個環境都不同的值，可以直接 diff。
--
-- 用法：
--   node scripts/compare-env-snapshots.mjs --run          # 自動跑兩個環境並比對
--   或在 SQL Editor 兩邊各跑一次、匯出 CSV，再：
--   node scripts/compare-env-snapshots.mjs prod.csv staging.csv
--
-- 預期會不同的類別：cron_job、vault_secret_name（staging 刻意不設定）、
-- extension_version（Supabase 平台自動升級）。
-- Vault 只列 secret 名稱，不讀值。
-- ============================================================================

WITH
public_ns AS (
  SELECT oid FROM pg_namespace WHERE nspname = 'public'
),
public_tables AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl
  FROM pg_class c
  WHERE c.relnamespace = (SELECT oid FROM public_ns)
    AND c.relkind IN ('r', 'p', 'v', 'm')
),
public_functions AS (
  SELECT p.*
  FROM pg_proc p
  WHERE p.pronamespace = (SELECT oid FROM public_ns)
),
rows AS (
  -- 已安裝的 extension 和所在 schema
  SELECT 'extension' AS section, e.extname AS object, 'schema=' || n.nspname AS detail
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace

  UNION ALL
  -- extension 版本：Supabase 平台會自動升級，兩邊不同屬於預期差異
  SELECT 'extension_version', e.extname, e.extversion
  FROM pg_extension e

  UNION ALL
  -- 資料表 / view 本身：種類、RLS
  SELECT 'table', t.relname,
         'kind=' || t.relkind::text || ' rls=' || t.relrowsecurity || ' force_rls=' || t.relforcerowsecurity
  FROM public_tables t

  UNION ALL
  -- 欄位：型別、NOT NULL、default
  SELECT 'column', t.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
           || COALESCE(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
  FROM public_tables t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE t.relkind IN ('r', 'p')

  UNION ALL
  -- constraint（PK、FK、CHECK、UNIQUE）
  SELECT 'constraint', t.relname || '.' || con.conname, pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN public_tables t ON t.oid = con.conrelid

  UNION ALL
  -- index
  SELECT 'index', i.indexname, i.indexdef
  FROM pg_indexes i
  WHERE i.schemaname = 'public'

  UNION ALL
  -- trigger（不含內部 FK trigger）
  SELECT 'trigger', t.relname || '.' || tg.tgname, pg_get_triggerdef(tg.oid)
  FROM pg_trigger tg
  JOIN public_tables t ON t.oid = tg.tgrelid
  WHERE NOT tg.tgisinternal

  UNION ALL
  -- view 定義（取 md5，避免輸出過長）
  SELECT 'view', t.relname, 'md5=' || md5(pg_get_viewdef(t.oid, true))
  FROM public_tables t
  WHERE t.relkind IN ('v', 'm')

  UNION ALL
  -- RLS policy：public 和 storage.objects
  SELECT 'policy', pol.schemaname || '.' || pol.tablename || '.' || pol.policyname,
         'cmd=' || pol.cmd
           || ' permissive=' || pol.permissive
           || ' roles=' || array_to_string(ARRAY(SELECT unnest(pol.roles) ORDER BY 1), ',')
           || ' using=' || COALESCE(pol.qual, '-')
           || ' check=' || COALESCE(pol.with_check, '-')
  FROM pg_policies pol
  WHERE pol.schemaname = 'public'
     OR (pol.schemaname = 'storage' AND pol.tablename = 'objects')

  UNION ALL
  -- 資料表權限（anon / authenticated / service_role / PUBLIC）
  SELECT 'table_grant', t.relname || ' → ' || COALESCE(r.rolname, 'PUBLIC'),
         string_agg(acl.privilege_type, ',' ORDER BY acl.privilege_type)
  FROM public_tables t
  CROSS JOIN LATERAL aclexplode(t.relacl) acl
  LEFT JOIN pg_roles r ON r.oid = acl.grantee
  WHERE acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role')
  GROUP BY t.relname, r.rolname

  UNION ALL
  -- 函式內容：md5（換行統一成 LF）、SECURITY DEFINER、search_path 等設定
  SELECT 'function', p.oid::regprocedure::text,
         'md5=' || md5(replace(p.prosrc, E'\r', ''))
           || ' definer=' || p.prosecdef
           || ' volatility=' || p.provolatile::text
           || ' returns=' || pg_get_function_result(p.oid)
           || ' config=' || COALESCE(array_to_string(p.proconfig, ';'), '-')
  FROM public_functions p

  UNION ALL
  -- 函式權限：誰能執行（最重要：anon 應該全部是 false，見 0214）
  SELECT 'function_grant', p.oid::regprocedure::text,
         'anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
           || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
           || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')
  FROM public_functions p

  UNION ALL
  -- enum 型別
  SELECT 'enum', ty.typname,
         string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type ty
  JOIN pg_enum e ON e.enumtypid = ty.oid
  WHERE ty.typnamespace = (SELECT oid FROM public_ns)
  GROUP BY ty.typname

  UNION ALL
  -- 新建物件的預設權限（0214 之後，public 的函式預設不應該給 anon / authenticated）
  SELECT 'default_acl',
         COALESCE(n.nspname, '(global)') || ' ' || pg_get_userbyid(d.defaclrole) || ' ' || d.defaclobjtype::text,
         d.defaclacl::text
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  WHERE n.nspname IS NULL OR n.nspname = 'public'

  UNION ALL
  -- Storage bucket 設定
  SELECT 'storage_bucket', b.id,
         'public=' || b.public
           || ' size_limit=' || COALESCE(b.file_size_limit::text, '-')
           || ' mime=' || COALESCE(array_to_string(b.allowed_mime_types, ','), '-')
  FROM storage.buckets b

  UNION ALL
  -- pg_cron 排程（staging 刻意不建，預期會不同）
  SELECT 'cron_job', j.jobname, j.schedule || ' ' || j.command || ' active=' || j.active
  FROM cron.job j

  UNION ALL
  -- Vault：只列名稱，不讀值（預期會不同）
  SELECT 'vault_secret_name', s.name, '-'
  FROM vault.secrets s
)
SELECT section, object, detail
FROM rows
ORDER BY section, object, detail;
