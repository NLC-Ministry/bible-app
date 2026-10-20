// 資料庫權限檢查（#594）：給 PGlite 測試（scripts/db-security.test.mjs）用的查詢與比對。
// 允許清單在 supabase/security-allowlist.json，每一項都要寫理由。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ALLOWLIST_PATH = fileURLToPath(new URL("../../supabase/security-allowlist.json", import.meta.url));

export function loadAllowlist(path = ALLOWLIST_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// extension 建的函式（pgcrypto 等）不算我們的
const OWN_PUBLIC_FUNCTIONS = `
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;

/** anon 能執行的 public 函式（簽名，例如 "foo(uuid,text)"）。 */
export async function anonExecutableFunctions(db) {
  const { rows } = await db.query(`
    SELECT p.oid::regprocedure::text AS signature ${OWN_PUBLIC_FUNCTIONS}
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
    ORDER BY 1`);
  return rows.map(row => row.signature);
}

/** authenticated 能執行的 SECURITY DEFINER public 函式。 */
export async function authenticatedSecurityDefinerFunctions(db) {
  const { rows } = await db.query(`
    SELECT p.oid::regprocedure::text AS signature ${OWN_PUBLIC_FUNCTIONS}
      AND p.prosecdef
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ORDER BY 1`);
  return rows.map(row => row.signature);
}

/** 沒開 RLS 的 public 資料表（anon key 透過 PostgREST 就能直接讀寫）。 */
export async function tablesWithoutRls(db) {
  const { rows } = await db.query(`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    ORDER BY 1`);
  return rows.map(row => row.name);
}

/** 實際清單 vs 允許清單：多出來的（要擋）與清單裡已經不存在的（要從清單拿掉）。 */
export function compareWithAllowlist(actual, allowed) {
  const allowedSet = new Set(allowed);
  const actualSet = new Set(actual);
  return {
    unexpected: actual.filter(item => !allowedSet.has(item)),
    stale: allowed.filter(item => !actualSet.has(item))
  };
}
