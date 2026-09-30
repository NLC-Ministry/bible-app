import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// #351：分頁查詢（fetchAllRows）每一頁都要有唯一且固定的排序。
// 每一頁是一次獨立的請求，沒有唯一排序時 PostgreSQL 可能每頁回傳不同順序
// （不同連線上的不同執行計畫、或 profiles 在登入時被 UPDATE 換了位置），
// 前後頁接不起來 → 有的抓兩次、有的沒抓到（#348 的 421 章變 374/375/418）。
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

function loadFetchAllRows() {
  const start = db.indexOf("const READING_TEAM_MEMBERS_ORDER");
  const end = db.indexOf("return { data: rows, error: null };\n}", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = db.slice(start, end) + "return { data: rows, error: null };\n}";
  return new Function(`${source}\nreturn { fetchAllRows, READING_TEAM_MEMBERS_ORDER };`)();
}

function loadNlcQueryBuilder(callEdge) {
  const start = db.indexOf("class NlcQueryBuilder {");
  const end = db.indexOf("\n    return {\n      async saveProfile", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function("callEdge", `${db.slice(start, end)}\nreturn NlcQueryBuilder;`)(callEdge);
}

function loadApplyOrder() {
  const start = nlcData.indexOf("function applyOrder(");
  const end = nlcData.indexOf("\nfunction applyFilters(", start);
  expect(start).toBeGreaterThan(-1);
  const source = nlcData.slice(start, end)
    .replace("function applyOrder(query: any, spec: { order?: any; orders?: any })", "function applyOrder(query, spec)");
  return new Function(`${source}\nreturn applyOrder;`)();
}

// 假的資料來源：同一份資料有兩種「沒有唯一排序時」的回傳順序（模擬兩種執行計畫），
// 每次請求輪流用；排序欄位完整指定到唯一鍵時，照指定欄位排。
function makeSource(rows, uniqueKey) {
  const orderA = rows;
  const orderB = [...rows].sort((a, b) => String(a.group).localeCompare(String(b.group)) || rows.indexOf(a) - rows.indexOf(b));
  let requestCount = 0;
  const calls = [];
  const buildQuery = () => {
    const request = { orders: [], range: null };
    const builder = {
      order(column, options) { request.orders.push([column, options?.ascending !== false]); return builder; },
      range(from, to) { request.range = [from, to]; return builder; },
      then(resolve, reject) {
        calls.push(request.orders.map(([column]) => column));
        const columns = request.orders.map(([column]) => column);
        const isUnique = uniqueKey.every(column => columns.includes(column));
        let source;
        if (isUnique) {
          source = [...rows].sort((a, b) => {
            for (const column of columns) {
              if (a[column] < b[column]) return -1;
              if (a[column] > b[column]) return 1;
            }
            return 0;
          });
        } else {
          source = requestCount % 2 === 0 ? orderA : orderB;
        }
        requestCount += 1;
        const [from, to] = request.range;
        return Promise.resolve({ data: source.slice(from, to + 1), error: null }).then(resolve, reject);
      }
    };
    return builder;
  };
  return { buildQuery, calls };
}

function makeProfiles(count) {
  return Array.from({ length: count }, (_, i) => ({ id: `p${String(i).padStart(5, "0")}`, name: `name${i % 7}`, group: i % 3 }));
}

describe("fetchAllRows 自動補唯一排序 (#351)", () => {
  it("預設在每一頁補上 id，1220 筆每筆剛好抓到一次", async () => {
    const { fetchAllRows } = loadFetchAllRows();
    const rows = makeProfiles(1220);
    const { buildQuery, calls } = makeSource(rows, ["id"]);
    const { data, error } = await fetchAllRows(buildQuery);
    expect(error).toBeNull();
    expect(data).toHaveLength(1220);
    expect(new Set(data.map(row => row.id)).size).toBe(1220);
    expect(calls.every(columns => columns.at(-1) === "id")).toBe(true);
  });

  it("沒有唯一排序時會漏抓（對照組：證明假資料來源真的會錯位）", async () => {
    const { fetchAllRows } = loadFetchAllRows();
    const rows = makeProfiles(1220);
    const { buildQuery } = makeSource(rows, ["id"]);
    const { data } = await fetchAllRows(buildQuery, { orderBy: [] });
    expect(data).toHaveLength(1220);
    expect(new Set(data.map(row => row.id)).size).toBeLessThan(1220);
  });

  it("呼叫端原本的排序保留在前面，id 接在後面當決勝鍵", async () => {
    const { fetchAllRows } = loadFetchAllRows();
    const rows = makeProfiles(450);
    const source = makeSource(rows, ["id"]);
    const buildQuery = () => source.buildQuery().order("name", { ascending: true });
    const { data } = await fetchAllRows(buildQuery);
    expect(new Set(data.map(row => row.id)).size).toBe(450);
    expect(source.calls[0]).toEqual(["name", "id"]);
    expect(data.map(row => row.name)).toEqual([...data.map(row => row.name)].sort());
  });

  it("reading_team_members 用 (team_id, user_id) 當唯一鍵", async () => {
    const { fetchAllRows, READING_TEAM_MEMBERS_ORDER } = loadFetchAllRows();
    expect(READING_TEAM_MEMBERS_ORDER).toEqual(["team_id", "user_id"]);
    const rows = Array.from({ length: 2024 }, (_, i) => ({ team_id: `t${String(i % 576).padStart(3, "0")}`, user_id: `u${String(i).padStart(4, "0")}`, group: i % 5 }));
    const { buildQuery, calls } = makeSource(rows, ["team_id", "user_id"]);
    const { data } = await fetchAllRows(buildQuery, { orderBy: READING_TEAM_MEMBERS_ORDER });
    expect(new Set(data.map(row => `${row.team_id}|${row.user_id}`)).size).toBe(2024);
    expect(calls[0]).toEqual(["team_id", "user_id"]);
  });
});

describe("NlcQueryBuilder 累積多個 .order() (#351)", () => {
  it("orders 帶全部欄位、order 只留第一個給舊版 nlc-data", async () => {
    let sent = null;
    const NlcQueryBuilder = loadNlcQueryBuilder(async request => { sent = request; return { data: [], error: null }; });
    await new NlcQueryBuilder("profiles").select("id, name").order("name", { ascending: true }).order("id", { ascending: true }).range(0, 199);
    expect(sent.orders).toEqual([{ column: "name", ascending: true }, { column: "id", ascending: true }]);
    expect(sent.order).toEqual({ column: "name", ascending: true });
    expect(sent.range).toEqual({ from: 0, to: 199 });
  });

  it("只呼叫一次 .order() 時，舊格式跟以前一樣", async () => {
    let sent = null;
    const NlcQueryBuilder = loadNlcQueryBuilder(async request => { sent = request; return { data: [], error: null }; });
    await new NlcQueryBuilder("global_plans").select("*").order("start_date", { ascending: false });
    expect(sent.order).toEqual({ column: "start_date", ascending: false });
    expect(sent.orders).toEqual([{ column: "start_date", ascending: false }]);
  });
});

describe("nlc-data applyOrder 支援多欄排序 (#351)", () => {
  function recorder() {
    const calls = [];
    const query = { order(column, options) { calls.push([column, options.ascending]); return query; } };
    return { query, calls };
  }

  it("新格式 orders 依序套用全部欄位", () => {
    const applyOrder = loadApplyOrder();
    const { query, calls } = recorder();
    applyOrder(query, { order: { column: "name" }, orders: [{ column: "name", ascending: true }, { column: "id", ascending: true }] });
    expect(calls).toEqual([["name", true], ["id", true]]);
  });

  it("舊前端只送 order 時照舊", () => {
    const applyOrder = loadApplyOrder();
    const { query, calls } = recorder();
    applyOrder(query, { order: { column: "start_date", ascending: false } });
    expect(calls).toEqual([["start_date", false]]);
  });

  it("沒有排序、或欄位不合法時不套用", () => {
    const applyOrder = loadApplyOrder();
    const { query, calls } = recorder();
    applyOrder(query, {});
    applyOrder(query, { orders: [null, { column: "" }, { column: 5 }] });
    expect(calls).toEqual([]);
  });

  it("單一 select 和 batch 兩條路徑都走 applyOrder", () => {
    expect(nlcData).toContain("query = applyOrder(query, spec);");
    expect(nlcData).toContain("query = applyOrder(query, body);");
    expect(nlcData).not.toMatch(/if \((spec|body)\.order\?\.column\)/);
  });
});

describe("所有 fetchAllRows 呼叫都有唯一排序鍵 (#351)", () => {
  // 沒有 id 欄位的表必須明確傳 orderBy（其餘預設用 id）。
  const TABLES_WITHOUT_ID = { reading_team_members: "READING_TEAM_MEMBERS_ORDER" };

  function walk(dir) {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  }

  function fetchAllRowsCalls(source) {
    const calls = [];
    const pattern = /fetchAllRows\(/g;
    let match;
    while ((match = pattern.exec(source))) {
      if (/function fetchAllRows\($/.test(source.slice(Math.max(0, match.index - 15), match.index + 13))) continue;
      let depth = 0;
      let index = match.index + "fetchAllRows".length;
      for (; index < source.length; index += 1) {
        if (source[index] === "(") depth += 1;
        else if (source[index] === ")" && --depth === 0) break;
      }
      calls.push(source.slice(match.index, index + 1));
    }
    return calls;
  }

  const files = walk(join(root, "js"))
    .filter(path => /\.(m?js|ts)$/.test(path) && !/\.test\./.test(path))
    .map(path => [relative(root, path).replace(/\\/g, "/"), readFileSync(path, "utf8").replace(/\r\n/g, "\n")]);
  const calls = files.flatMap(([file, source]) => fetchAllRowsCalls(source).map(call => [file, call]));

  it("找得到呼叫點", () => {
    expect(calls.length).toBeGreaterThanOrEqual(20);
  });

  it("沒有 id 欄位的表都傳了自己的唯一鍵", () => {
    const offenders = calls.filter(([, call]) => Object.entries(TABLES_WITHOUT_ID).some(([table, key]) =>
      call.includes(`from("${table}")`) && !call.includes(`orderBy: ${key}`)));
    expect(offenders).toEqual([]);
    expect(calls.filter(([, call]) => call.includes('from("reading_team_members")')).length).toBe(3);
  });

  it("沒有人還用舊的第二個參數（pageSize 數字）", () => {
    const legacy = calls.filter(([, call]) => /,\s*\d+\s*\)$/.test(call));
    expect(legacy).toEqual([]);
  });
});
