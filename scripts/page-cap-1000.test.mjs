import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PAGE_SIZE, LEGACY_SERVER_PAGE_CAP, isLastPage, normalizePageSize } from "../js/data/pagination.mjs";
import { fetchReadingLogsByPlanIds } from "../js/data/reading-log-batches.mjs";
import { SupabaseRepository } from "../js/pwa/SupabaseRepository.js";

// #399：nlc-data 每頁上限 200 → 1,000。前端一律要 1,000 筆、以實際拿到的筆數前進，
// 只有 0 筆或少於舊上限 200 筆才停——新前端配舊版 nlc-data（只給 200 筆）也要完整。
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

function loadFetchAllRows() {
  const start = db.indexOf("const READING_TEAM_MEMBERS_ORDER");
  const end = db.indexOf("return { data: rows, error: null };\n}", start);
  const source = db.slice(start, end) + "return { data: rows, error: null };\n}";
  return new Function("DEFAULT_PAGE_SIZE", "isLastPage", "normalizePageSize",
    `${source}\nreturn fetchAllRows;`)(DEFAULT_PAGE_SIZE, isLastPage, normalizePageSize);
}
const fetchAllRows = loadFetchAllRows();

// 假伺服器：像 nlc-data 一樣把 .range() 跨度夾到 cap 筆。
function makeServer(total, cap) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i + 1 }));
  const requests = [];
  const builder = () => {
    const self = {
      select() { return self; },
      eq() { return self; },
      in() { return self; },
      order() { return self; },
      range(from, to) {
        requests.push([from, to]);
        const end = Math.min(to, from + cap - 1);
        return Promise.resolve({ data: rows.slice(from, end + 1), error: null });
      }
    };
    return self;
  };
  return { rows, requests, builder, client: { from: () => builder() } };
}

const paginators = {
  fetchAllRows: async server => (await fetchAllRows(() => server.builder())).data,
  "readingLogRepository.fetchAllPages": async server => {
    const repository = new SupabaseRepository({ table: "reading_logs", clientProvider: () => server.client });
    return (await repository.fetch({ query: table => table.select("*").order("id", { ascending: true }) })).data;
  },
  fetchReadingLogsByPlanIds: async server => (await fetchReadingLogsByPlanIds(server.client, ["plan-a"])).data
};

describe.each(Object.entries(paginators))("%s (#399)", (_name, run) => {
  it("前端預設每頁要 1,000 筆", async () => {
    const server = makeServer(5, 1000);
    await run(server);
    expect(server.requests[0]).toEqual([0, 999]);
  });

  it("舊版伺服器只給 200 筆：不會提早停，1,189 筆全拿到", async () => {
    const server = makeServer(1189, 200);
    const data = await run(server);
    expect(data.map(row => row.id)).toEqual(server.rows.map(row => row.id));
    expect(server.requests.map(([from]) => from)).toEqual([0, 200, 400, 600, 800, 1000]);
  });

  it("新版伺服器上限 1,000：請求數約為原本的 1/5", async () => {
    const newServer = makeServer(5189, 1000);
    const oldServer = makeServer(5189, 200);
    expect(await run(newServer)).toHaveLength(5189);
    expect(await run(oldServer)).toHaveLength(5189);
    expect(newServer.requests).toHaveLength(6);
    expect(oldServer.requests).toHaveLength(26);
  });

  it.each([
    // [總筆數, 伺服器上限, 預期請求數]
    [0, 1000, 1],
    [199, 200, 1],
    [199, 1000, 1],
    [200, 200, 2],
    [200, 1000, 2],
    [1000, 200, 6],
    [1000, 1000, 2],
    [1001, 1000, 2]
  ])("邊界：共 %i 筆、伺服器上限 %i → 完整且 %i 次請求", async (total, cap, expectedRequests) => {
    const server = makeServer(total, cap);
    const data = await run(server);
    expect(data.map(row => row.id)).toEqual(server.rows.map(row => row.id));
    expect(server.requests).toHaveLength(expectedRequests);
  });
});

describe("分頁停止規則 (#399)", () => {
  it("只有 0 筆或少於 min(頁大小, 200) 才停", () => {
    expect(LEGACY_SERVER_PAGE_CAP).toBe(200);
    expect(isLastPage(0, 1000)).toBe(true);
    expect(isLastPage(199, 1000)).toBe(true);
    expect(isLastPage(200, 1000)).toBe(false);
    expect(isLastPage(999, 1000)).toBe(false);
    expect(isLastPage(1000, 1000)).toBe(false);
    expect(isLastPage(1, 2)).toBe(true);
    expect(isLastPage(2, 2)).toBe(false);
  });

  it("頁大小預設 1,000，不合法或超過時回到 1,000", () => {
    expect(normalizePageSize(undefined)).toBe(1000);
    expect(normalizePageSize(0)).toBe(1000);
    expect(normalizePageSize("abc")).toBe(1000);
    expect(normalizePageSize(5000)).toBe(1000);
    expect(normalizePageSize(2)).toBe(2);
  });

  it("前端三個分頁器都以實際筆數前進，不再用 from += pageSize", () => {
    expect(db).toContain("from += page.length;");
    expect(db).not.toMatch(/from \+= pageSize/);
    expect(read("js/pwa/SupabaseRepository.js")).toContain("from += page.length;");
    expect(read("js/data/reading-log-batches.mjs")).toContain("from += page.length;");
  });

  it("nlc-data 三處上限共用同一個 1,000 常數", () => {
    expect(nlcData).toContain("const MAX_ROWS_PER_REQUEST = 1000;");
    expect(nlcData.split("rangeFrom + MAX_ROWS_PER_REQUEST - 1").length - 1).toBe(2);
    expect(nlcData.split("Math.min(MAX_ROWS_PER_REQUEST, Math.max(1, Number(").length - 1).toBe(2);
    expect(nlcData).not.toContain("rangeFrom + 199");
    expect(nlcData).not.toContain("Math.min(200,");
  });
});
