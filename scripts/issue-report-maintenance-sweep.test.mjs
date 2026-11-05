// #671：孤兒截圖清理會真的刪 Storage 檔案，所以測試實際跑 issue-report-maintenance 的 handler
// （假的資料庫與 Storage，會照真實語意分頁，刪檔也真的從假 Storage 消失），斷言哪些檔案被刪掉，
// 不比對原始碼字串。原則：寧可少刪，不可把使用中的附件刪掉。
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => globalThis.__sweepFakeWorld.client()
}));

const SECRET = "maintenance-secret";
const LONG_AGO = "2020-01-01T00:00:00.000Z";
const PAGE = 1000;

function uuid(prefix, n) {
  return `${prefix}0000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

// 同一個種子每次測試都一樣，失敗才能重現
function shuffled(rows, seed) {
  const out = [...rows];
  let state = seed * 2654435761 % 4294967296;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

class MessagesQuery {
  constructor(world) {
    this.world = world;
    this.ordered = false;
    this.afterId = null;
    this.window = null;
  }
  select() { return this; }
  not() { return this; }
  order(column) {
    if (column !== "id") throw new Error(`unexpected order column ${column}`);
    this.ordered = true;
    return this;
  }
  gt(column, value) {
    if (column !== "id") throw new Error(`unexpected gt column ${column}`);
    this.afterId = value;
    return this;
  }
  limit(count) { this.window = [0, count]; return this; }
  range(from, to) { this.window = [from, to + 1]; return this; }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }

  run() {
    const world = this.world;
    const call = ++world.messageQueries;
    world.log.push("read-messages");
    const fault = world.messagePageFault?.(call);
    if (fault) return fault;
    let rows = world.messages.filter((row) => row.attachment_path !== null);
    if (this.afterId !== null) rows = rows.filter((row) => row.id > this.afterId);
    // 沒有 ORDER BY 時 Postgres 不保證順序：每次查詢都可能排得不一樣
    rows = this.ordered
      ? [...rows].sort((a, b) => (a.id < b.id ? -1 : 1))
      : shuffled(rows, call);
    const [start, end] = this.window || [0, rows.length];
    const page = rows
      .slice(start, Math.min(end, start + world.maxRows))
      .map((row) => ({ ...row }));
    world.afterMessagePage?.(call);
    return { data: page, error: null };
  }
}

function makeWorld({ messages = [], files = {}, maxRows = PAGE, ...hooks } = {}) {
  const world = {
    messages: messages.map((row) => ({ ...row })),
    // folder 名稱 → { 檔名: created_at }
    files: Object.fromEntries(Object.entries(files).map(([folder, entries]) => [folder, { ...entries }])),
    maxRows,
    messageQueries: 0,
    log: [],
    removed: [],
    listInFlight: 0,
    listMaxInFlight: 0,
    ...hooks,
    client() {
      return {
        from: (table) => {
          if (table !== "issue_report_messages") throw new Error(`unexpected table ${table}`);
          return new MessagesQuery(world);
        },
        rpc: async () => ({ data: 0, error: null }),
        storage: {
          from: () => ({
            list: (prefix, options) => world.list(prefix, options),
            remove: async (paths) => world.remove(paths)
          })
        }
      };
    },
    async list(prefix, options) {
      world.log.push(`list:${prefix}`);
      world.listInFlight += 1;
      world.listMaxInFlight = Math.max(world.listMaxInFlight, world.listInFlight);
      await Promise.resolve();
      world.listInFlight -= 1;
      const fault = world.listFault?.(prefix, options);
      if (fault) return fault;
      const entries = prefix === ""
        ? Object.keys(world.files).map((name) => ({ name, id: null, created_at: null, updated_at: null }))
        : Object.entries(world.files[prefix] || {}).map(([name, createdAt]) => ({
            name,
            id: createdAt ? `file-${name}` : null,
            created_at: createdAt,
            updated_at: createdAt
          }));
      entries.sort((a, b) => (a.name < b.name ? -1 : 1));
      const offset = options?.offset || 0;
      return { data: entries.slice(offset, offset + (options?.limit ?? 100)), error: null };
    },
    remove(paths) {
      world.log.push("remove");
      for (const path of paths) {
        const [folder, name] = path.split("/");
        delete world.files[folder]?.[name];
        world.removed.push(path);
      }
      return { data: paths.map((name) => ({ name })), error: null };
    }
  };
  return world;
}

// count 則有附件的訊息（每 20 則一個資料夾），再加上每個資料夾一個真正的孤兒檔
function usedAttachments(count, { createdAt = LONG_AGO } = {}) {
  const messages = [];
  const files = {};
  const usedPaths = [];
  const orphanPaths = [];
  for (let i = 0; i < count; i++) {
    const folder = uuid("a", Math.floor(i / 20));
    const name = `${uuid("b", i)}.webp`;
    const path = `${folder}/${name}`;
    messages.push({ id: uuid("b", i), attachment_path: path });
    files[folder] ||= {};
    files[folder][name] = createdAt;
    usedPaths.push(path);
  }
  for (const folder of Object.keys(files)) {
    const name = `${uuid("c", orphanPaths.length)}.webp`;
    files[folder][name] = createdAt;
    orphanPaths.push(`${folder}/${name}`);
  }
  return { messages, files, usedPaths, orphanPaths };
}

let handler;

async function runPurge(world) {
  globalThis.__sweepFakeWorld = world;
  const response = await handler(new Request("https://fn.test/issue-report-maintenance", {
    method: "POST",
    headers: { "x-maintenance-secret": SECRET },
    body: JSON.stringify({ purge: true })
  }));
  return { status: response.status, body: await response.json() };
}

let consoleError;

beforeAll(async () => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("Deno", {
    env: {
      get: (key) => ({
        SUPABASE_URL: "https://db.test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        ISSUE_REPORT_MAINTENANCE_SECRET: SECRET
      })[key]
    },
    serve: (fn) => { handler = fn; }
  });
  await import("../supabase/functions/issue-report-maintenance/index.ts");
});

afterAll(() => {
  consoleError.mockRestore();
  vi.unstubAllGlobals();
  delete globalThis.__sweepFakeWorld;
});

describe("孤兒截圖清理：使用中的附件不能被刪（#671）", () => {
  it("附件超過 1000 筆、資料庫不保證順序時，使用中的路徑都不會進刪除清單", async () => {
    const { messages, files, usedPaths, orphanPaths } = usedAttachments(2500);
    const world = makeWorld({ messages, files });

    const { status, body } = await runPurge(world);

    expect(status).toBe(200);
    const removed = new Set(world.removed);
    expect(usedPaths.filter((path) => removed.has(path))).toEqual([]);
    expect([...removed].sort()).toEqual([...orphanPaths].sort());
    expect(body.orphanShotsRemoved).toBe(orphanPaths.length);
  });

  it("翻頁途中有訊息列被刪掉（其他人的操作）也不會跳過後面的列", async () => {
    const { messages, files, usedPaths } = usedAttachments(1500);
    const world = makeWorld({
      messages,
      files,
      afterMessagePage(call) {
        if (call === 1) world.messages.shift();
      }
    });

    await runPurge(world);

    const removed = new Set(world.removed);
    // 被刪掉訊息的那張圖（usedPaths[0]）確實變成孤兒，其他都還在使用中
    expect(usedPaths.slice(1).filter((path) => removed.has(path))).toEqual([]);
  });

  it("伺服器每頁上限比程式要的小（max_rows）時，不會以為讀完了", async () => {
    const { messages, files, usedPaths } = usedAttachments(1500);
    const world = makeWorld({ messages, files, maxRows: 500 });

    await runPurge(world);

    const removed = new Set(world.removed);
    expect(usedPaths.filter((path) => removed.has(path))).toEqual([]);
  });

  it("讀使用中路徑的任何一頁失敗：回 500、一個檔都不刪", async () => {
    const { messages, files } = usedAttachments(1500);
    const world = makeWorld({
      messages,
      files,
      messagePageFault: (call) => (call === 2 ? { data: null, error: { message: "boom" } } : null)
    });

    const { status } = await runPurge(world);

    expect(status).toBe(500);
    expect(world.removed).toEqual([]);
  });

  it("某一頁沒有 error 卻也沒有資料：當成失敗，不當成讀完了", async () => {
    const { messages, files } = usedAttachments(1500);
    const world = makeWorld({
      messages,
      files,
      messagePageFault: (call) => (call === 2 ? { data: null, error: null } : null)
    });

    const { status } = await runPurge(world);

    expect(status).toBe(500);
    expect(world.removed).toEqual([]);
  });

  it("資料夾列表或檔案列表任何一頁失敗：回 500、一個檔都不刪", async () => {
    for (const failing of [
      (prefix) => prefix === "",
      (prefix) => prefix === uuid("a", 3)
    ]) {
      const { messages, files } = usedAttachments(200);
      const world = makeWorld({
        messages,
        files,
        listFault: (prefix) => (failing(prefix) ? { data: null, error: { message: "boom" } } : null)
      });

      const { status } = await runPurge(world);

      expect(status).toBe(500);
      expect(world.removed).toEqual([]);
    }
  });

  it("剛上傳、還沒寫回訊息的檔案不算孤兒（訊息還是 pending）", async () => {
    const report = uuid("a", 1);
    const now = new Date().toISOString();
    const world = makeWorld({
      messages: [{ id: uuid("b", 1), attachment_path: "pending" }],
      files: { [report]: { [`${uuid("b", 1)}.webp`]: now, "old-orphan.webp": LONG_AGO } }
    });

    await runPurge(world);

    expect(world.removed).toEqual([`${report}/old-orphan.webp`]);
  });

  it("看不出上傳時間的項目（例如子資料夾）不刪", async () => {
    const report = uuid("a", 1);
    const world = makeWorld({
      files: { [report]: { "nested-folder": null, "old-orphan.webp": LONG_AGO } }
    });

    await runPurge(world);

    expect(world.removed).toEqual([`${report}/old-orphan.webp`]);
  });

  it("先列完 Storage 再讀使用中路徑，全部讀完才開始刪", async () => {
    const { messages, files } = usedAttachments(100);
    const world = makeWorld({ messages, files });

    await runPurge(world);

    const firstRead = world.log.indexOf("read-messages");
    const lastList = world.log.findLastIndex((entry) => entry.startsWith("list:"));
    const lastRead = world.log.lastIndexOf("read-messages");
    const firstRemove = world.log.indexOf("remove");
    expect(lastList).toBeLessThan(firstRead);
    expect(lastRead).toBeLessThan(firstRemove);
  });
});

describe("孤兒截圖清理：超過 1000 個也要掃得到（#671）", () => {
  it("資料夾超過 1000 個：後面的資料夾也會被掃", async () => {
    const files = {};
    const expected = [];
    for (let i = 0; i < 2300; i++) {
      const folder = uuid("a", i);
      files[folder] = { "orphan.webp": LONG_AGO };
      expected.push(`${folder}/orphan.webp`);
    }
    const world = makeWorld({ files });

    const { body } = await runPurge(world);

    expect([...world.removed].sort()).toEqual(expected.sort());
    expect(body.orphanShotsRemoved).toBe(2300);
  });

  it("單一資料夾檔案超過 1000 個：全部掃到，不會因為邊刪邊翻頁漏掉", async () => {
    const folder = uuid("a", 1);
    const entries = {};
    const expected = [];
    for (let i = 0; i < 2300; i++) {
      const name = `${uuid("c", i)}.webp`;
      entries[name] = LONG_AGO;
      expected.push(`${folder}/${name}`);
    }
    const world = makeWorld({ files: { [folder]: entries } });

    const { body } = await runPurge(world);

    expect([...world.removed].sort()).toEqual(expected.sort());
    expect(body.orphanShotsRemoved).toBe(2300);
    expect(Object.keys(world.files[folder])).toEqual([]);
  });

  it("檔案數剛好是整頁的倍數也不會漏，資料夾列表不會同時開超過 5 個", async () => {
    const files = {};
    const expected = [];
    for (let f = 0; f < 12; f++) {
      const folder = uuid("a", f);
      files[folder] = {};
      for (let i = 0; i < (f === 0 ? PAGE : 1); i++) {
        const name = `${uuid("c", i)}.webp`;
        files[folder][name] = LONG_AGO;
        expected.push(`${folder}/${name}`);
      }
    }
    const world = makeWorld({ files });

    await runPurge(world);

    expect([...world.removed].sort()).toEqual(expected.sort());
    expect(world.listMaxInFlight).toBeLessThanOrEqual(5);
  });
});
