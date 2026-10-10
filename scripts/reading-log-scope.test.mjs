import { describe, expect, it, vi } from "vitest";
import {
  addLoadedPlanToScope,
  applyOpenReadingLogFilter,
  collectReadDateKeys,
  createPlanReadingLogLoader,
  createReadingLogScope,
  digestChapterKeys,
  digestRoundLogs,
  filterOpenScopeLogs,
  getLazilyLoadedPlanIds,
  isLogInOpenScope,
  isPlanReadingLogsLoaded,
  loadBootReadingLogs,
  mergeOpenScopeReadingLogs,
  mergePlanReadingLogs,
  normalizeReadingLogDigest,
  parseReadingLogScope,
  partitionEnrollmentsByCheckIn,
  readingLogCacheKeys,
  removePlanFromDigest
} from "../js/data/reading-log-scope.mjs";

const TODAY = { todayISO: "2026-10-09" };

const globalRows = [
  { id: "g-sep", end_date: "2026-09-30", grace_days: 0, is_fixed: true },
  { id: "g-grace", end_date: "2026-10-05", grace_days: 7, is_fixed: true },
  { id: "g-oct", end_date: "2026-10-31", grace_days: 0, is_fixed: true },
  { id: "g-flex", end_date: "2026-01-01", grace_days: 0, is_fixed: false }
];

const enrollments = [
  { id: "p-sep", global_plan_id: "g-sep", end_date: "2026-09-30" },
  { id: "p-grace", global_plan_id: "g-grace", end_date: "2026-10-05" },
  { id: "p-oct", global_plan_id: "g-oct", end_date: "2026-10-31" },
  { id: "p-flex", global_plan_id: "g-flex", end_date: "2026-01-01" },
  { id: "p-personal-old", global_plan_id: null, end_date: "2026-08-31", is_fixed: true },
  { id: "p-personal-now", global_plan_id: null, end_date: "2026-12-31", is_fixed: true },
  // 隱藏的 global_plan 被 nlc-data 濾掉：不知道寬限期 → 保守給 30 天
  { id: "p-hidden-recent", global_plan_id: "g-hidden", end_date: "2026-09-20" },
  { id: "p-hidden-old", global_plan_id: "g-hidden", end_date: "2026-08-01" }
];

describe("#474 哪些計畫開機要載逐筆紀錄", () => {
  it("跟伺服器觸發器同一條規則：global_plan 固定日期且過了 end_date + grace_days 才算關閉", () => {
    const { openPlanIds, closedPlanIds } = partitionEnrollmentsByCheckIn(enrollments, globalRows, TODAY);
    expect(openPlanIds).toEqual(["p-grace", "p-oct", "p-flex", "p-personal-now", "p-hidden-recent"]);
    expect(closedPlanIds).toEqual(["p-sep", "p-personal-old", "p-hidden-old"]);
  });

  it("開機查詢只帶還能打卡的計畫＋無歸屬紀錄", () => {
    const calls = [];
    const query = {
      or(value) { calls.push(["or", value]); return this; },
      is(column, value) { calls.push(["is", column, value]); return this; }
    };
    applyOpenReadingLogFilter(query, ["p-oct", "p-grace", "p-oct"]);
    expect(calls).toEqual([["or", "plan_id.in.(p-oct,p-grace),plan_id.is.null"]]);

    calls.length = 0;
    applyOpenReadingLogFilter(query, []);
    expect(calls).toEqual([["is", "plan_id", null]]);
  });

  it("快取 key 分成開機範圍與單一計畫兩份", () => {
    expect(readingLogCacheKeys("u1")).toEqual(["reading_logs:u1:open"]);
    expect(readingLogCacheKeys("u1", "p-sep")).toEqual(["reading_logs:u1:open", "reading_logs:u1:plan:p-sep"]);
    expect(readingLogCacheKeys(null, "p-sep")).toEqual([]);
  });
});

describe("#474 開機載入", () => {
  const digestPayload = {
    chapters: [
      { plan_id: "p-sep", round: 1, book: "出埃及記", chapters: [1, 2, 3] },
      { plan_id: "p-sep", round: 2, book: "出埃及記", chapters: [1] }
    ],
    read_dates: ["2026-09-29", "2026-09-30", "2026-09-30"]
  };

  it("只查進行中計畫的逐筆紀錄，已關閉計畫只拿摘要", async () => {
    const fetchOpenLogs = vi.fn(async () => ({ data: [{ book: "利未記", chapter: 1, plan_id: "p-oct", round: 1 }], error: null }));
    const fetchDigest = vi.fn(async () => ({ data: digestPayload, error: null }));
    const fetchClosedLogs = vi.fn();
    const result = await loadBootReadingLogs({
      enrollments: enrollments.slice(0, 3),
      globalPlanRows: globalRows,
      fetchOpenLogs,
      fetchDigest,
      fetchClosedLogs,
      options: TODAY
    });
    expect(fetchOpenLogs).toHaveBeenCalledWith(["p-grace", "p-oct"]);
    expect(fetchDigest).toHaveBeenCalledWith(["p-sep"]);
    expect(fetchClosedLogs).not.toHaveBeenCalled();
    expect(result.scope).toEqual({ mode: "open", openPlanIds: ["p-grace", "p-oct"], loadedPlanIds: ["p-grace", "p-oct"] });
    expect(result.digest.byPlan["p-sep"]).toEqual({ 1: { 出埃及記: [1, 2, 3] }, 2: { 出埃及記: [1] } });
    expect(result.digest.readDates).toEqual(["2026-09-29", "2026-09-30"]);
    expect(result.logsResult.data).toHaveLength(1);
  });

  it("沒有已關閉計畫就不呼叫摘要 RPC", async () => {
    const fetchDigest = vi.fn();
    const result = await loadBootReadingLogs({
      enrollments: [enrollments[2]],
      globalPlanRows: globalRows,
      fetchOpenLogs: async () => ({ data: [], error: null }),
      fetchDigest,
      fetchClosedLogs: vi.fn(),
      options: TODAY
    });
    expect(fetchDigest).not.toHaveBeenCalled();
    expect(result.scope.mode).toBe("open");
  });

  it("摘要拿不到（nlc-data 還沒部署）→ 已關閉計畫照舊抓逐筆，scope 退回 all", async () => {
    const fetchClosedLogs = vi.fn(async () => ({ data: [{ book: "創世記", chapter: 1, plan_id: "p-sep", round: 1 }], error: null }));
    const result = await loadBootReadingLogs({
      enrollments: enrollments.slice(0, 3),
      globalPlanRows: globalRows,
      fetchOpenLogs: async () => ({ data: [{ book: "利未記", chapter: 1, plan_id: "p-oct", round: 1 }], error: null }),
      fetchDigest: async () => ({ data: null, error: { message: "unsupported_function" } }),
      fetchClosedLogs,
      options: TODAY
    });
    expect(fetchClosedLogs).toHaveBeenCalledWith(["p-sep"]);
    expect(result.scope.mode).toBe("all");
    expect(result.digest).toBeNull();
    expect(result.logsResult.data.map(log => log.plan_id)).toEqual(["p-oct", "p-sep"]);
  });

  it("摘要 RPC 丟例外也走退路", async () => {
    const fetchClosedLogs = vi.fn(async () => ({ data: [], error: null }));
    const result = await loadBootReadingLogs({
      enrollments: enrollments.slice(0, 1),
      globalPlanRows: globalRows,
      fetchOpenLogs: async () => ({ data: [], error: null }),
      fetchDigest: async () => { throw new Error("network"); },
      fetchClosedLogs,
      options: TODAY
    });
    expect(fetchClosedLogs).toHaveBeenCalled();
    expect(result.scope.mode).toBe("all");
  });

  it("逐筆紀錄查詢失敗 → 回報錯誤，呼叫端保留既有紀錄", async () => {
    const result = await loadBootReadingLogs({
      enrollments: enrollments.slice(0, 3),
      globalPlanRows: globalRows,
      fetchOpenLogs: async () => ({ data: null, error: { message: "boom" } }),
      fetchDigest: async () => ({ data: digestPayload, error: null }),
      fetchClosedLogs: vi.fn(),
      options: TODAY
    });
    expect(result.logsResult.error).toEqual({ message: "boom" });
    expect(result.scope).toBeNull();
  });
});

describe("#474 點進已結束計畫才載入", () => {
  it("沒載入過才抓、同時要好幾次只發一個請求、載入後不再抓", async () => {
    let scope = createReadingLogScope({ mode: "open", openPlanIds: ["p-oct"] });
    let logs = [];
    let resolveFetch;
    const fetchPlanLogs = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    const ensure = createPlanReadingLogLoader({
      isLoaded: planId => isPlanReadingLogsLoaded(scope, planId),
      fetchPlanLogs,
      applyPlanLogs: (planId, rows) => {
        logs = mergePlanReadingLogs(logs, rows, planId);
        scope = addLoadedPlanToScope(scope, planId);
      }
    });

    expect(await ensure("p-oct")).toBe(false);
    expect(fetchPlanLogs).not.toHaveBeenCalled();

    const first = ensure("p-sep");
    const second = ensure("p-sep");
    expect(fetchPlanLogs).toHaveBeenCalledTimes(1);
    expect(fetchPlanLogs).toHaveBeenCalledWith("p-sep");
    resolveFetch({ data: [{ book: "創世記", chapter: 1, plan_id: "p-sep", round: 1, read_at: "2026-09-01T00:00:00Z" }], error: null });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(logs).toHaveLength(1);
    expect(scope.loadedPlanIds).toEqual(["p-oct", "p-sep"]);

    expect(await ensure("p-sep")).toBe(false);
    expect(fetchPlanLogs).toHaveBeenCalledTimes(1);
  });

  it("請求失敗不標成已載入，下次再試", async () => {
    let attempts = 0;
    const ensure = createPlanReadingLogLoader({
      isLoaded: () => false,
      fetchPlanLogs: async () => { attempts++; throw new Error("offline"); },
      applyPlanLogs: vi.fn()
    });
    expect(await ensure("p-sep")).toBe(false);
    expect(await ensure("p-sep")).toBe(false);
    expect(attempts).toBe(2);
  });

  it("重新整理只沿用真的按需載入過的計畫，不含上次的開機範圍", () => {
    const scope = addLoadedPlanToScope(createReadingLogScope({ mode: "open", openPlanIds: ["p-oct", "p-grace"] }), "p-sep");
    expect(getLazilyLoadedPlanIds(scope)).toEqual(["p-sep"]);
    expect(getLazilyLoadedPlanIds(createReadingLogScope())).toEqual([]);
  });

  it("scope all（整包都載入了）不抓任何計畫", () => {
    expect(isPlanReadingLogsLoaded(createReadingLogScope(), "p-sep")).toBe(true);
    expect(isPlanReadingLogsLoaded(null, "p-sep")).toBe(true);
  });
});

describe("#474 摘要", () => {
  const digest = normalizeReadingLogDigest(JSON.stringify({
    chapters: [
      { plan_id: "p-sep", round: 1, book: "出埃及記", chapters: [3, 1, 2, 2] },
      { plan_id: "p-sep", round: 3, book: "出埃及記", chapters: [5] },
      { plan_id: "p-sep", round: 2, book: "出埃及記", chapters: [] },
      { plan_id: null, round: 1, book: "創世記", chapters: [1] }
    ],
    read_dates: ["2026-09-01", "bad", null]
  }));

  it("正規化：同章去重排序、空遍與無歸屬列忽略、日期只收 YYYY-MM-DD", () => {
    expect(digest.byPlan).toEqual({ "p-sep": { 1: { 出埃及記: [1, 2, 3] }, 3: { 出埃及記: [5] } } });
    expect(digest.readDates).toEqual(["2026-09-01"]);
    expect(normalizeReadingLogDigest({ nope: true })).toBeNull();
    expect(normalizeReadingLogDigest("not json")).toBeNull();
  });

  it("給遍數確認用的遍數、給進度比對用的章節 key", () => {
    expect(digestRoundLogs(digest, "p-sep")).toEqual([{ round: 1 }, { round: 3 }]);
    expect(digestRoundLogs(digest, "p-other")).toEqual([]);
    expect(digestChapterKeys(digest, "p-sep")).toEqual(["1_出埃及記_1", "1_出埃及記_2", "1_出埃及記_3", "3_出埃及記_5"]);
  });

  it("退出計畫時把那個計畫從摘要拿掉", () => {
    expect(removePlanFromDigest(digest, "p-sep").byPlan).toEqual({});
    expect(digest.byPlan["p-sep"]).toBeDefined();
  });
});

describe("#474 合併紀錄與已讀標記", () => {
  const scope = addLoadedPlanToScope(createReadingLogScope({ mode: "open", openPlanIds: ["p-oct"] }), "p-sep");
  const existing = [
    { book: "利未記", chapter: 1, plan_id: "p-oct", round: 1, read_at: "2026-10-01T00:00:00Z" },
    { book: "出埃及記", chapter: 1, plan_id: "p-sep", round: 1, read_at: "2026-09-01T00:00:00Z" },
    { book: "民數記", chapter: 1, plan_id: "p-aug", round: 1, read_at: "2026-08-01T00:00:00Z" },
    { book: "詩篇", chapter: 23, plan_id: null, round: 1, read_at: "2026-07-01T00:00:00Z" }
  ];

  it("開機範圍的新資料換掉 open＋無歸屬，保留按需載入過的計畫", () => {
    const incoming = [{ book: "利未記", chapter: 2, plan_id: "p-oct", round: 1, read_at: "2026-10-02T00:00:00Z" }];
    const merged = mergeOpenScopeReadingLogs(existing, incoming, scope);
    expect(merged.map(log => `${log.plan_id}:${log.book}${log.chapter}`).sort())
      .toEqual(["p-oct:利未記2", "p-sep:出埃及記1"]);
  });

  it("開機途中 SWR 先發布的資料不能讓其他計畫的紀錄暫時消失", () => {
    const merged = mergeOpenScopeReadingLogs(existing, [], scope, { keepOtherPlans: true });
    expect(merged.map(log => log.plan_id).sort()).toEqual(["p-aug", "p-sep"]);
  });

  it("scope all 時整包換掉（原本的行為）並去重留最新", () => {
    const merged = mergeOpenScopeReadingLogs(existing, [
      { book: "創世記", chapter: 1, plan_id: "p-x", round: 1, read_at: "2026-01-01T00:00:00Z" },
      { book: "創世記", chapter: 1, plan_id: "p-x", round: 1, read_at: "2026-02-01T00:00:00Z" }
    ], createReadingLogScope());
    expect(merged).toEqual([{ book: "創世記", chapter: 1, plan_id: "p-x", round: 1, read_at: "2026-02-01T00:00:00Z" }]);
  });

  it("讀經器已讀標記與離線快照只看還能打卡的計畫＋無歸屬紀錄", () => {
    expect(filterOpenScopeLogs(existing, scope).map(log => log.book)).toEqual(["利未記", "詩篇"]);
    expect(isLogInOpenScope(createReadingLogScope(), existing[2])).toBe(true);
  });

  it("離線快照還原：舊快照（沒有 scope）當成全部紀錄", () => {
    expect(parseReadingLogScope(null).mode).toBe("all");
    expect(parseReadingLogScope({ mode: "open", openPlanIds: ["p-oct"] }))
      .toEqual({ mode: "open", openPlanIds: ["p-oct"], loadedPlanIds: ["p-oct"] });
  });

  it("連續天數用已載入紀錄的日期 ∪ 摘要日期", () => {
    const dates = collectReadDateKeys(
      [{ read_at: "2026-10-01T00:00:00Z" }, { read_at: "" }],
      { readDates: ["2026-09-30", "2026-10-01"] },
      value => value ? String(value).slice(0, 10) : ""
    );
    expect(dates).toEqual(["2026-10-01", "2026-09-30"]);
  });
});
