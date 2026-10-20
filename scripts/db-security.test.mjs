import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptMigrationSql, createMigratedDb, listMigrationFiles } from "./lib/pglite-supabase.mjs";
import {
  anonExecutableFunctions,
  authenticatedSecurityDefinerFunctions,
  compareWithAllowlist,
  loadAllowlist,
  tablesWithoutRls
} from "./lib/db-security-checks.mjs";

// #594：把 CLAUDE.md「新 SQL 函式要明確 REVOKE/GRANT」變成會擋的檢查。
// 在 PGlite 從空資料庫套用 supabase/migrations/ 的全部 migration，再查實際權限
// （has_function_privilege，不是讀 GRANT 語句）。允許清單：supabase/security-allowlist.json。

let db;
const allowlist = loadAllowlist();

beforeAll(async () => {
  db = await createMigratedDb();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** 在交易裡做一件事、跑檢查，最後 rollback。 */
async function withTemporary(sql, check) {
  let result;
  await db.transaction(async tx => {
    await tx.exec(sql);
    result = await check(tx);
    await tx.rollback();
  }).catch(error => {
    if (!/rollback|aborted/i.test(String(error?.message))) throw error;
  });
  return result;
}

const explain = (kind, { unexpected, stale }) => [
  unexpected.length ? `${kind}多出：\n  ${unexpected.join("\n  ")}\n→ 在 migration 裡 REVOKE ALL … FROM PUBLIC, anon, authenticated 並只 GRANT 給需要的角色；真的要開放就加進 supabase/security-allowlist.json 並寫理由。` : "",
  stale.length ? `${kind}允許清單裡已經不存在（從 supabase/security-allowlist.json 拿掉）：\n  ${stale.join("\n  ")}` : ""
].filter(Boolean).join("\n");

describe("migration 從空資料庫套用", () => {
  it("包含全部 migration 檔（早期四位數在 timestamp 檔之前）", () => {
    const files = listMigrationFiles();
    expect(files[0]).toBe("0001_clean_schema.sql");
    expect(files.length).toBeGreaterThan(280);
    const versions = files.map(file => file.split("_")[0].padStart(14, "0"));
    expect([...versions].sort()).toEqual(versions);
  });

  it("PGlite 沒有的 extension 換成空操作，其他不動", () => {
    expect(adaptMigrationSql("CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;\nSELECT 1;"))
      .toBe("/* CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog; */\nSELECT 1;");
    expect(adaptMigrationSql("CREATE EXTENSION IF NOT EXISTS pgcrypto;")).toBe("CREATE EXTENSION IF NOT EXISTS pgcrypto;");
  });
});

describe("函式權限", () => {
  it("anon 不能執行任何 public 函式（除了允許清單）", async () => {
    const diff = compareWithAllowlist(
      await anonExecutableFunctions(db),
      Object.keys(allowlist.anon_executable_functions.functions)
    );
    expect(diff, explain("anon 可執行的函式", diff)).toEqual({ unexpected: [], stale: [] });
  });

  it("authenticated 能執行的 SECURITY DEFINER 函式不能比基準多", async () => {
    const diff = compareWithAllowlist(
      await authenticatedSecurityDefinerFunctions(db),
      allowlist.authenticated_security_definer_functions.baseline_2026_10_20
    );
    expect(diff, explain("authenticated 可執行的 SECURITY DEFINER 函式", diff)).toEqual({ unexpected: [], stale: [] });
  });

  it("檢查抓得到：忘了 REVOKE 的新函式", async () => {
    // 0214 之後新函式預設不給 anon；這裡模擬有人又明確 GRANT 給 anon
    const found = await withTemporary(`
      CREATE FUNCTION public.zz_probe_forgot_revoke() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
      GRANT EXECUTE ON FUNCTION public.zz_probe_forgot_revoke() TO anon;
    `, anonExecutableFunctions);
    expect(found).toContain("zz_probe_forgot_revoke()");
  });

  it("檢查抓得到：只 REVOKE FROM PUBLIC、沒收回 anon 的直接授權", async () => {
    const found = await withTemporary(`
      CREATE FUNCTION public.zz_probe_public_only() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
      GRANT EXECUTE ON FUNCTION public.zz_probe_public_only() TO anon;
      REVOKE ALL ON FUNCTION public.zz_probe_public_only() FROM PUBLIC;
    `, anonExecutableFunctions);
    expect(found).toContain("zz_probe_public_only()");
  });

  it("檢查抓得到：GRANT 給 authenticated 的 SECURITY DEFINER 新函式", async () => {
    const found = await withTemporary(`
      CREATE FUNCTION public.zz_probe_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      GRANT EXECUTE ON FUNCTION public.zz_probe_definer() TO authenticated;
    `, authenticatedSecurityDefinerFunctions);
    expect(found).toContain("zz_probe_definer()");
  });

  it("照 CLAUDE.md 寫法 REVOKE＋只給 service_role 的函式不會被抓", async () => {
    const found = await withTemporary(`
      CREATE FUNCTION public.zz_probe_ok() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.zz_probe_ok() FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.zz_probe_ok() TO service_role;
    `, async tx => [...await anonExecutableFunctions(tx), ...await authenticatedSecurityDefinerFunctions(tx)]);
    expect(found).not.toContain("zz_probe_ok()");
  });
});

describe("資料表 RLS", () => {
  it("public 的資料表都開了 RLS（除了允許清單）", async () => {
    const diff = compareWithAllowlist(await tablesWithoutRls(db), Object.keys(allowlist.tables_without_rls.tables));
    expect(diff, explain("沒開 RLS 的資料表", diff)).toEqual({ unexpected: [], stale: [] });
  });

  it("檢查抓得到：沒開 RLS 的新資料表", async () => {
    const found = await withTemporary(`CREATE TABLE public.zz_probe_no_rls (id int);`, tablesWithoutRls);
    expect(found).toContain("zz_probe_no_rls");
  });
});

describe("允許清單格式", () => {
  it("每一區都有理由", () => {
    for (const key of ["anon_executable_functions", "tables_without_rls", "authenticated_security_definer_functions", "security_advisor"]) {
      expect(allowlist[key]?._理由, key).toBeTruthy();
    }
    for (const [name, reason] of Object.entries({
      ...allowlist.anon_executable_functions.functions,
      ...allowlist.tables_without_rls.tables,
      ...allowlist.security_advisor.lints,
      ...allowlist.security_advisor.cache_keys
    })) {
      expect(typeof reason === "string" && reason.trim().length > 0, `${name} 要寫理由`).toBe(true);
    }
  });
});
