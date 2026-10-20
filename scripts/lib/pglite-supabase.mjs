// 在 PGlite（WASM 版 Postgres）裡模擬 Supabase 的環境，再從空資料庫套用
// supabase/migrations/ 的全部 migration（#594）。給 CI 跑資料庫的權限檢查與行為測試用，
// 不需要任何 Supabase 金鑰。
//
// 模擬的只有 migration 用得到的部分：
// - 角色 anon／authenticated／service_role，以及 Supabase 對 public schema 的預設權限
//   （新建的資料表、函式會直接 GRANT 給這三個角色——CLAUDE.md 要求每個新函式明確
//   REVOKE 的原因，這裡照做，權限檢查才有意義）。
// - auth.uid()／auth.role()／auth.jwt() 讀 request.jwt.claims（跟 PostgREST 一樣），
//   auth.users、storage.buckets／objects 只有欄位。
// - pg_cron、pg_net、Vault 在 PGlite 沒有：CREATE EXTENSION 換成空操作，
//   cron.schedule／net.http_post／vault.create_secret 等是只記錄、不執行的替身。

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));

export const SUPABASE_BOOTSTRAP_SQL = `
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  CREATE ROLE authenticator NOINHERIT;
  CREATE ROLE supabase_admin;
  CREATE ROLE supabase_auth_admin;
  CREATE ROLE supabase_storage_admin;
  CREATE ROLE dashboard_user;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS vault;

GRANT USAGE ON SCHEMA public, extensions, auth, storage TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_sign_in_at timestamptz
);

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$f$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT nullif(auth.jwt() ->> 'role', '')
$f$;
CREATE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT nullif(auth.jwt() ->> 'email', '')
$f$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  owner uuid,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$f$;

-- pg_cron 替身：只記錄排程，不執行
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  jobname text UNIQUE,
  active boolean DEFAULT true
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid
$f$;
CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint
LANGUAGE sql AS $f$
  INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid
$f$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d)
$f$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean
LANGUAGE sql AS $f$
  WITH d AS (DELETE FROM cron.job WHERE jobid = job_id RETURNING 1) SELECT EXISTS (SELECT 1 FROM d)
$f$;

-- pg_net 替身：只記錄請求，不發送
CREATE TABLE net.http_request_queue (
  id bigserial PRIMARY KEY,
  url text,
  headers jsonb,
  body jsonb,
  created timestamptz DEFAULT now()
);
CREATE TABLE net._http_response (
  id bigint,
  status_code integer,
  content text,
  created timestamptz DEFAULT now()
);
CREATE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO net.http_request_queue (url, headers, body) VALUES (url, headers, body) RETURNING id
$f$;

-- Vault 替身：明文存放（只在測試用的暫存資料庫裡）
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text,
  secret text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret, created_at, updated_at FROM vault.secrets;
CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '')
RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id
$f$;
CREATE FUNCTION vault.update_secret(secret_id uuid, new_secret text DEFAULT NULL, new_name text DEFAULT NULL,
  new_description text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $f$
  UPDATE vault.secrets SET secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now()
  WHERE id = secret_id
$f$;
`;

/** PGlite 沒有的 extension：CREATE EXTENSION 換成註解（替身在 bootstrap 裡）。 */
const UNAVAILABLE_EXTENSIONS = ["pg_cron", "pg_net", "supabase_vault", "pg_graphql", "pg_stat_monitor"];

export function adaptMigrationSql(sql) {
  const names = UNAVAILABLE_EXTENSIONS.join("|");
  return sql
    .replace(new RegExp(`CREATE\\s+EXTENSION\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"?(${names})"?[^;]*;`, "gi"), "/* $& */")
    .replace(new RegExp(`DROP\\s+EXTENSION\\s+(IF\\s+EXISTS\\s+)?"?(${names})"?[^;]*;`, "gi"), "/* $& */");
}

/** supabase/migrations/ 的檔案，依版本排序（早期的 0001～0214 在 timestamp 檔之前）。 */
export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter(file => /^(\d{4}|\d{14})_.+\.sql$/.test(file))
    .sort((a, b) => a.split("_")[0].padStart(14, "0").localeCompare(b.split("_")[0].padStart(14, "0")));
}

export async function createSupabaseDb() {
  const db = await PGlite.create({ extensions: { pgcrypto, uuid_ossp, pg_trgm } });
  await db.exec(SUPABASE_BOOTSTRAP_SQL);
  return db;
}

/**
 * 從空資料庫套用全部 migration。onError 可以選擇略過（回傳 true）；預設遇錯就丟出，
 * 錯誤訊息帶檔名。
 */
export async function applyMigrations(db, { dir = MIGRATIONS_DIR, files = listMigrationFiles(dir), onError } = {}) {
  const applied = [];
  for (const file of files) {
    const sql = adaptMigrationSql(readFileSync(join(dir, file), "utf8"));
    try {
      await db.exec(sql);
      applied.push(file);
    } catch (error) {
      if (onError?.(file, error)) continue;
      throw new Error(`套用 ${file} 失敗：${error.message}`, { cause: error });
    }
  }
  return applied;
}

/** 建好並套用完 migration 的資料庫。 */
export async function createMigratedDb(options) {
  const db = await createSupabaseDb();
  await applyMigrations(db, options);
  return db;
}
