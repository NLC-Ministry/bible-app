// 回報附診斷資訊（#548）：送出時帶 metadata.diagnostics；管理端摘要列。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReportPipeline, SubmitReportBlock } from "../IssueReportBlocks.ts";
import { diagnosticsSummaryRows } from "../AdminReportView.tsx";

if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
  (globalThis as any).window.location = { href: "http://localhost/test", pathname: "/test", hash: "#/plan" };
}

describe("ReportPipeline diagnostics", () => {
  let inserted: any[] = [];

  beforeEach(() => {
    inserted = [];
    (window as any).APP_BUILD_ID = "20261011090000";
    (window as any).state = {
      currentUser: { id: "user-1" },
      supabase: {
        from: () => ({
          insert: (rows: any[]) => {
            inserted.push(...rows);
            return Promise.resolve({ error: null });
          }
        })
      }
    };
    vi.spyOn(SubmitReportBlock, "isOnline").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).state;
    delete (window as any).APP_BUILD_ID;
  });

  it("attaches metadata.diagnostics to the submitted report", async () => {
    const result = await ReportPipeline.execute("bug", "打卡按下去沒有反應，重新整理也一樣。");
    expect(result.success).toBe(true);
    expect(inserted).toHaveLength(1);
    const diagnostics = inserted[0].metadata?.diagnostics;
    expect(diagnostics).toMatchObject({ v: 1, build_id: "20261011090000" });
    expect(Array.isArray(diagnostics.recent_requests)).toBe(true);
    expect(Array.isArray(diagnostics.recent_errors)).toBe(true);
    expect(Object.keys(inserted[0].metadata)).toEqual(["diagnostics"]);
  });
});

describe("diagnosticsSummaryRows", () => {
  it("labels each field for the admin view, with fallbacks for missing values", () => {
    const rows = Object.fromEntries(diagnosticsSummaryRows({
      build_id: "20261011090000",
      submitted_at: "2026-10-11T03:00:00.000Z",
      standalone: true,
      online: false,
      route: "#/plan",
      active_plan_id: "plan-1",
      data_source: { reading_data_source: "cache", reading_data_stale: "true", repository_error: null },
      offline_queue: { available: true, pending: 2, failed: 1, last_error: "HTTP 500" }
    }));
    expect(rows["版本"]).toBe("20261011090000");
    expect(rows["送出時間"]).toContain("11:00");
    expect(rows["開啟方式"]).toBe("主畫面 App");
    expect(rows["網路"]).toBe("離線");
    expect(rows["資料來源"]).toBe("cache（舊資料）");
    expect(rows["資料讀取錯誤"]).toBe("無");
    expect(rows["離線佇列"]).toBe("待送 2／失敗 1");
    expect(rows["佇列最後錯誤"]).toBe("HTTP 500");

    const empty = Object.fromEntries(diagnosticsSummaryRows({}));
    expect(empty["版本"]).toBe("—");
    expect(empty["離線佇列"]).toBe("讀不到");
    expect(empty).not.toHaveProperty("佇列最後錯誤");
  });
});
