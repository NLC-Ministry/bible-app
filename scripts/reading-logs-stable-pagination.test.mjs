import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SupabaseRepository } from "../js/pwa/SupabaseRepository.js";

// #348：累積閱讀章數每次重整都不一樣而且偏少（421 顯示成 374/375/418）。
// reading_logs 每頁 200 筆分頁、卻沒有固定排序；小組長以上經過 nlc-data forced
// scope 的查詢，在不同連線上會走不同索引（custom plan → idx_reading_logs_user_id，
// generic plan → idx_reading_logs_user_plan），回傳順序不同，前後頁接不起來。
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8");
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
// #370：統計、排行、組員狀況搬到 plan-stats.js。
const planStats = read("js/modules/plan-stats.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");
const migrationFile = readdirSync(join(root, "supabase/migrations"))
  .find(name => name.endsWith("_plan_chapter_total.sql"));
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";

// 假的 client：同一份資料有兩種「沒排序時」的回傳順序（模擬兩種執行計畫），
// 每次請求輪流用其中一種；呼叫過 .order("id") 就一律照 id 排。
function makeClient(rows) {
  const orderA = rows;
  const orderB = [...rows].sort((a, b) => a.plan_id.localeCompare(b.plan_id) || rows.indexOf(a) - rows.indexOf(b));
  let requestCount = 0;
  return {
    from() {
      const request = { orderColumn: null, range: null };
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order(column) { request.orderColumn = column; return builder; },
        range(from, to) { request.range = [from, to]; return builder; },
        then(resolve, reject) {
          const source = request.orderColumn === "id"
            ? [...rows].sort((a, b) => a.id - b.id)
            : (requestCount % 2 === 0 ? orderA : orderB);
          requestCount += 1;
          const [from, to] = request.range || [0, source.length - 1];
          return Promise.resolve({ data: source.slice(from, to + 1), error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

// 交錯存放的兩個計畫的紀錄：存放順序跟「先照計畫分組」的順序不一樣。
function makeRows() {
  const rows = [];
  for (let i = 0; i < 950; i += 1) {
    rows.push({ id: i + 1, plan_id: i % 3 === 0 ? "plan-a" : "plan-b", book: "出埃及記", chapter: (i % 40) + 1, round: Math.floor(i / 40) + 1 });
  }
  return rows;
}

const uniqueIds = rows => new Set(rows.map(row => row.id)).size;

describe("reading_logs 分頁要有固定排序 (#348)", () => {
  it("不排序時，前後頁順序不同會重複或漏抓（重現 bug）", async () => {
    const rows = makeRows();
    const repository = new SupabaseRepository({ table: "reading_logs", clientProvider: (client => () => client)(makeClient(rows)) });
    // 950 筆在預設每頁 1,000 筆（#399）時一頁就抓完，看不出錯位；用舊的每頁 200 筆重現。
    const { data } = await repository.fetch({ query: table => table.select("*").eq("user_id", "u"), pageSize: 200 });
    expect(data).toHaveLength(rows.length);
    expect(uniqueIds(data)).toBeLessThan(rows.length);
  });

  it("照 id 排序後，每一筆剛好抓到一次", async () => {
    const rows = makeRows();
    const repository = new SupabaseRepository({ table: "reading_logs", clientProvider: (client => () => client)(makeClient(rows)) });
    const { data } = await repository.fetch({
      query: table => table.select("*").eq("user_id", "u").order("id", { ascending: true })
    });
    expect(data).toHaveLength(rows.length);
    expect(uniqueIds(data)).toBe(rows.length);
  });

  it("db.js 兩條 reading_logs 載入路徑都照 id 排序", () => {
    const select = 'select("book, chapter, read_at, plan_id, round").eq("user_id", user.id)';
    const occurrences = db.split(select).length - 1;
    expect(occurrences).toBe(2);
    expect(db.split(`${select}.order("id", { ascending: true })`).length - 1).toBe(2);
  });
});

describe("累積閱讀章數由伺服器計算 (#348)", () => {
  it("migration 只數呼叫者自己在這個計畫的不重複章節", () => {
    expect(migrationFile).toBeTruthy();
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_my_plan_chapter_total(p_plan_id uuid, p_actor_id uuid DEFAULT NULL::uuid)");
    expect(migration).toContain("SELECT DISTINCT log.book, log.chapter, log.round");
    expect(migration).toContain("log.user_id = p_actor_id");
    expect(migration).toContain("log.plan_id = p_plan_id");
    expect(migration).toContain("p_actor_id IS NOT NULL");
  });

  it("migration 只授權 service_role", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_my_plan_chapter_total(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_my_plan_chapter_total(uuid, uuid) TO service_role;");
    expect(migration).not.toMatch(/GRANT[^;]*get_my_plan_chapter_total[^;]*\b(anon|authenticated)\b/);
  });

  it("nlc-data 開放這支 RPC 並注入 p_actor_id", () => {
    expect(nlcData).toMatch(/const READING_STATS_RPC_FUNCTIONS = new Set\(\[\s*"get_my_plan_chapter_total"\s*\]\)/);
    expect(nlcData).toContain("...READING_STATS_RPC_FUNCTIONS");
    expect(nlcData).toContain("|| READING_STATS_RPC_FUNCTIONS.has(functionName)");
    expect(nlcData).toContain("rpcArgs = { ...(body.args || {}), p_actor_id: profile.id };");
  });

  it("個人統計先顯示本機數字，伺服器回來取較大的，舊請求不覆蓋新畫面", () => {
    expect(db).toContain('state.supabase.rpc("get_my_plan_chapter_total", { p_plan_id: planId })');
    expect(planStats).toContain("db.fetchPlanChapterTotal(totalPlanId)");
    expect(planStats).toContain("reportStatTotalChapters.textContent = Math.max(serverTotal, localTotal);");
    expect(planStats).toContain("totalRenderToken !== planChapterTotalRenderToken");
    expect(planStats).toContain("state.activePlan.id !== totalPlanId");
  });
});
