import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// #263：刪除 profiles 的示範帳號欄位。
// profiles_no_demo（D1）保證沒有示範帳號，所以「排除示範帳號」的條件永遠成立。
// 第 1 步：網站與 Edge Functions 不再讀寫這個欄位；第 2 步：migration 刪掉欄位。
// 欄位名稱用拼接的，這個測試檔本身才不會被自己的全 repo 掃描抓到。
const COLUMN = ["is", "demo"].join("_");
const MIGRATION_NAME = `drop_profiles_${COLUMN}`;
const MIGRATION_FILE = `supabase/migrations/20260929093001_${MIGRATION_NAME}.sql`;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(js|mjs|ts|tsx|html)$/.test(name)) out.push(path);
  }
  return out;
}

describe("the app no longer uses the demo column", () => {
  const files = [
    ...walk("js"),
    ...walk("components"),
    ...walk("lib"),
    "index.html",
    "exam.html",
    "grade.html",
    "supabase/functions/nlc-data/index.ts",
    "supabase/functions/nlc-session/index.ts",
    "scripts/staging-sample-data.mjs"
  ];

  it.each(files)("%s does not reference the demo column", file => {
    expect(readFileSync(file, "utf8")).not.toMatch(new RegExp(`${COLUMN}|isDemo\\b`));
  });
});

// 驗收條件：整個 repo 只剩舊 migration 檔裡有這個欄位名稱。
// docs/superpowers/ 是有日期的舊實作計畫（當時的程式碼片段），保留原樣。
// 引用 #263 migration 的檔名（其他測試會讀它）不算。
describe("only migrations still mention the demo column", () => {
  const EXCLUDED = [/^supabase\/migrations\//, /^supabase\/migrations_legacy\//, /^docs\/superpowers\//];
  const TEXT = /\.(js|mjs|cjs|ts|tsx|jsx|html|css|sql|md|json|toml|ya?ml|sh|txt)$/i;
  const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter(path => TEXT.test(path) && !EXCLUDED.some(pattern => pattern.test(path)));

  it("scans the repo", () => {
    expect(tracked.length).toBeGreaterThan(100);
    expect(tracked).toContain("supabase/supabase_schema.sql");
  });

  it("finds it nowhere else", () => {
    const offenders = tracked.filter(path => {
      try {
        return readFileSync(path, "utf8").split(MIGRATION_NAME).join("").toLowerCase().includes(COLUMN);
      } catch {
        return false; // 已刪除但還沒 commit 的檔案
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe("step 2 migration drops the column", () => {
  const migration = readFileSync(MIGRATION_FILE, "utf8");
  const sqlOnly = migration.split(/\r?\n/).filter(line => !line.trim().startsWith("--")).join("\n");
  const position = text => {
    const index = sqlOnly.indexOf(text);
    expect(index, text).toBeGreaterThanOrEqual(0);
    return index;
  };
  const dropColumn = `ALTER TABLE public.profiles DROP COLUMN ${COLUMN};`;

  const REWRITTEN = [
    ["send_plan_join_invitation", "uuid, uuid, text, uuid"],
    ["get_personal_plan_ranking_summary", "uuid, uuid"],
    ["protect_profile_privileged_fields", ""],
    ["get_admin_registration_statistics", "uuid, uuid"],
    ["get_pastoral_zone_leaderboard", "uuid, uuid"],
    ["get_admin_member_team_placements", "uuid, uuid"],
    ["get_unjoined_plan_members", "uuid, text, uuid"],
    ["get_org_structure_tree", "uuid, text, text[], text[], text[]"],
    ["get_joined_plan_members", "uuid, text, uuid"]
  ];

  const fnBlock = name => {
    const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    expect(start, `${name} is rewritten`).toBeGreaterThanOrEqual(0);
    return migration.slice(start, migration.indexOf("-- ──", start + 1));
  };

  it("drops the column without CASCADE, after everything that depended on it", () => {
    const drop = position(dropColumn);
    expect(sqlOnly).not.toMatch(/DROP COLUMN[^;]*CASCADE/i);
    for (const [name] of REWRITTEN) expect(sqlOnly.indexOf(`FUNCTION public.${name}(`)).toBeLessThan(drop);
    expect(position("CREATE OR REPLACE VIEW public.member_reading_summary")).toBeLessThan(drop);
    expect(position("ALTER TABLE public.profiles DROP CONSTRAINT profiles_no_demo;")).toBeLessThan(drop);
    expect(position(`DROP INDEX public.idx_profiles_${COLUMN};`)).toBeLessThan(drop);
  });

  it.each(REWRITTEN)("%s no longer reads the column and keeps its grants", (name, signature) => {
    const block = fnBlock(name);
    expect(block).not.toContain(COLUMN);
    expect(block).toContain(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated;`);
    expect(block).toContain(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO authenticated, service_role;`);
  });

  it("never grants anything to anon", () => {
    expect(sqlOnly).not.toMatch(/GRANT[^;]*\banon\b/i);
  });

  it("keeps the view's columns and security_invoker", () => {
    const start = position("CREATE OR REPLACE VIEW public.member_reading_summary");
    const view = sqlOnly.slice(start, sqlOnly.indexOf(";", start));
    expect(view).toContain("WITH (security_invoker = on) AS");
    expect(view).not.toContain(COLUMN);
    for (const column of ["AS user_id", "profile.name", "profile.role_id", "AS role_code", "AS role_label",
      "profile.great_region", "profile.pastoral_zone", "profile.small_group", "AS plan_count", "AS log_count", "AS last_read_at"]) {
      expect(view).toContain(column);
    }
  });

  it("rebuilds the two partial indexes before dropping the old ones, under the original names", () => {
    for (const [index, columns] of [
      ["idx_profiles_active_great_region", "(great_region)"],
      ["idx_profiles_active_zone_group", "(pastoral_zone, small_group)"]
    ]) {
      const create = position(`CREATE INDEX ${index}_263\n  ON public.profiles USING btree ${columns}\n  WHERE is_active = TRUE;`);
      const drop = position(`DROP INDEX public.${index};`);
      const rename = position(`ALTER INDEX public.${index}_263 RENAME TO ${index};`);
      expect(create).toBeLessThan(drop);
      expect(drop).toBeLessThan(rename);
      expect(rename).toBeLessThan(position(dropColumn));
    }
    expect(sqlOnly).toContain("COMMENT ON INDEX public.idx_profiles_active_great_region IS");
  });

  it("ends with checks for leftovers, the rebuilt indexes and anon EXECUTE", () => {
    const verify = position(`DO $verify_${COLUMN}_removed$`);
    expect(verify).toBeGreaterThan(position(dropColumn));
    expect(sqlOnly).toContain(`RAISE EXCEPTION '${COLUMN} is still referenced: %'`);
    expect(sqlOnly).toContain("RAISE EXCEPTION 'partial indexes");
    expect(sqlOnly).toContain("RAISE EXCEPTION 'member_reading_summary lost security_invoker'");
    expect(sqlOnly).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});
