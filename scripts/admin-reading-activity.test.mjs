import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import {
  addDays,
  buildActivitySeries,
  buildHeatmap,
  buildL7View,
  defaultRange,
  formatPct,
  heatLevel,
  renderAdminReadingActivity,
  summarizeActivity,
  taipeiDateString,
  validateRange
} from "../js/modules/admin-reading-activity.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = suffix => {
  const file = readdirSync(new URL("../supabase/migrations/", import.meta.url)).find(name => name.endsWith(suffix));
  return read(`supabase/migrations/${file}`);
};

describe("reading activity dates", () => {
  it("uses the Taiwan date, not the UTC date", () => {
    // 2026-10-06 17:30 UTC＝台灣 10/7 01:30
    expect(taipeiDateString(new Date("2026-10-06T17:30:00Z"))).toBe("2026-10-07");
  });

  it("defaults to the last 30 days including today", () => {
    expect(defaultRange("2026-10-07")).toEqual({ from: "2026-09-08", to: "2026-10-07" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("rejects reversed, missing, or longer-than-180-day ranges", () => {
    expect(validateRange("2026-10-07", "2026-10-01")).toMatch("起日不能晚於迄日");
    expect(validateRange("", "2026-10-01")).toMatch("請選擇");
    expect(validateRange("2026-04-11", "2026-10-07")).toBeNull(); // 剛好 180 天
    expect(validateRange("2026-04-10", "2026-10-07")).toMatch("180");
  });
});

describe("DAU／WAU／MAU (#452)", () => {
  const series = buildActivitySeries([
    { date: "2026-10-05", dau: 10, wau: 30, mau: 50 },
    { date: "2026-10-06", dau: 20, wau: 35, mau: 50 },
    { date: "2026-10-07", dau: 0, wau: 35, mau: 0 }
  ]);

  it("computes stickiness as DAU ÷ MAU and leaves it empty when MAU is 0", () => {
    expect(series.map(point => point.stickiness)).toEqual([0.2, 0.4, null]);
    expect(series[0].label).toBe("10/5");
  });

  it("summarizes the average DAU, the last day's WAU／MAU, and the average stickiness", () => {
    const summary = summarizeActivity(series);
    expect(summary.avgDau).toBe(10);
    expect(summary.latest.wau).toBe(35);
    expect(summary.avgStickiness).toBeCloseTo(0.3);
    expect(formatPct(summary.avgStickiness)).toBe("30.0%");
    expect(summarizeActivity([]).latest).toBeNull();
  });
});

describe("L7 (#453)", () => {
  it("fills missing buckets with 0 and computes each bucket's share of the week's readers", () => {
    const view = buildL7View({
      current: { weekStart: "2026-10-05", weekEnd: "2026-10-11", coveredEnd: "2026-10-07", dayCount: 3, total: 4,
        buckets: [{ days: 1, users: 1 }, { days: 3, users: 3 }] },
      previous: { weekStart: "2026-09-28", weekEnd: "2026-10-04", coveredEnd: "2026-10-04", dayCount: 7, total: 0, buckets: [] }
    });
    expect(view.current.rows.map(row => row.users)).toEqual([1, 0, 3, 0, 0, 0, 0]);
    expect(view.current.rows[2].pct).toBe(0.75);
    expect(view.current.label).toBe("10/5～10/11");
    expect(view.previous.rows.every(row => row.users === 0 && row.pct === null)).toBe(true);
  });
});

describe("hour heatmap (#454)", () => {
  const data = {
    dayCounts: { 1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0 },
    cells: [
      { dow: 1, hour: 6, sumUsers: 9, sumChapters: 30 },
      { dow: 2, hour: 21, sumUsers: 3, sumChapters: 12 }
    ]
  };

  it("averages each cell over how many times that weekday appears in the range, always 7 × 24 cells", () => {
    const { rows, max } = buildHeatmap(data, "users");
    expect(rows).toHaveLength(7);
    expect(rows.every(row => row.cells.length === 24)).toBe(true);
    expect(rows[0].cells[6].value).toBe(4.5); // 9 人次 ÷ 2 個星期一
    expect(rows[1].cells[21].value).toBe(3);
    expect(rows[6].cells[0].value).toBe(0); // 區間裡沒有星期日也不會除以 0
    expect(max).toBe(4.5);
    expect(buildHeatmap(data, "chapters").rows[0].cells[6].value).toBe(15);
  });

  it("leaves empty cells uncolored and keeps the faintest non-empty cell visible", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(10, 10)).toBe(100);
    expect(heatLevel(0.1, 10)).toBeGreaterThanOrEqual(15);
  });
});

describe("renderAdminReadingActivity", () => {
  function setup(overrides = {}) {
    const dom = new JSDOM(`<input id="admin-reading-activity-from" type="date"><input id="admin-reading-activity-to" type="date">
      <div id="admin-reading-activity-trend"></div><div id="admin-reading-activity-l7"></div><div id="admin-reading-activity-heatmap"></div>`);
    const doc = dom.window.document;
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    vi.stubGlobal("document", doc);
    const db = {
      getReadingActivity: vi.fn(async () => ({ success: true, data: { days: [{ date: "2026-10-07", dau: 2, wau: 3, mau: 4 }] } })),
      getReadingActivityL7: vi.fn(async () => ({ success: true, data: {
        current: { weekStart: "2026-10-05", weekEnd: "2026-10-11", coveredEnd: "2026-10-07", dayCount: 3, total: 1, buckets: [{ days: 2, users: 1 }] },
        previous: { weekStart: "2026-09-28", weekEnd: "2026-10-04", coveredEnd: "2026-10-04", dayCount: 7, total: 0, buckets: [] }
      } })),
      getReadingHourHeatmap: vi.fn(async () => ({ success: true, data: { dayCounts: { 1: 1 }, cells: [{ dow: 1, hour: 6, sumUsers: 2, sumChapters: 5 }] } })),
      ...overrides
    };
    const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    const run = () => renderAdminReadingActivity({
      db,
      escapeHTML,
      ensureChartLib: () => Promise.reject(new Error("offline")),
      getElement: id => doc.getElementById(id),
      now: () => new Date("2026-10-07T04:00:00Z")
    });
    return { doc, db, run };
  }

  it("loads the default 30-day range, and falls back to tables when the chart library is unavailable", async () => {
    const { doc, db, run } = setup();
    await expect(run()).resolves.toBe(true);
    expect(db.getReadingActivity).toHaveBeenCalledWith("2026-09-08", "2026-10-07");
    expect(db.getReadingActivityL7).toHaveBeenCalledWith("2026-10-07");
    expect(db.getReadingHourHeatmap).toHaveBeenCalledWith("2026-09-08", "2026-10-07");
    expect(doc.querySelector("#admin-reading-activity-trend canvas")).toBeNull();
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("平均 DAU");
    expect(doc.querySelector("#admin-reading-activity-l7").textContent).toContain("最多只會到 3 天");
    expect(doc.querySelectorAll(".admin-reading-activity__cell")).toHaveLength(168);
    vi.unstubAllGlobals();
  });

  it("switches the heatmap between people and chapters, and shows a tapped cell's number", async () => {
    const { doc, run } = setup();
    await run();
    const monday6 = () => doc.querySelectorAll("#admin-reading-activity-heatmap tbody tr")[0].querySelectorAll("button")[6];
    expect(monday6().dataset.heatmapText).toContain("平均每天 2 人");
    doc.querySelector('[data-heatmap-metric="chapters"]').click();
    expect(monday6().dataset.heatmapText).toContain("平均每天 5 章");
    monday6().click();
    expect(doc.querySelector("[data-heatmap-readout]").textContent).toContain("星期一 6:00");
    vi.unstubAllGlobals();
  });

  it("shows each block's own error without blocking the others, and does not call the server for an invalid range", async () => {
    const { doc, db, run } = setup({ getReadingActivityL7: vi.fn(async () => ({ success: false, message: "只有系統管理員可以查看讀經使用率。" })) });
    await run();
    expect(doc.querySelector("#admin-reading-activity-l7").textContent).toContain("只有系統管理員");
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("平均 DAU");

    const from = doc.getElementById("admin-reading-activity-from");
    from.value = "2026-01-01";
    from.dispatchEvent(new doc.defaultView.Event("change"));
    await Promise.resolve();
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("180");
    expect(db.getReadingActivity).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("reading activity wiring", () => {
  const nlcData = read("supabase/functions/nlc-data/index.ts");
  const admin = read("js/modules/admin.js");
  const indexHtml = read("index.html");

  it("is a system-administrator-only admin section", () => {
    expect(admin).toMatch(/\{ id: 'reading-activity',[^}]*panel: 'system'/);
    expect(admin).toContain("'reading-activity': () => [renderAdminReadingActivity(");
    expect(indexHtml).toContain('id="admin-section-reading-activity"');
  });

  it("lets nlc-data inject the actor for the three RPCs", () => {
    for (const name of ["admin_get_reading_activity", "admin_get_reading_activity_l7", "admin_get_reading_hour_heatmap"]) {
      expect(nlcData).toContain(`"${name}"`);
    }
    expect(nlcData).toContain("...READING_ACTIVITY_RPC_FUNCTIONS");
    expect(nlcData).toContain("|| READING_ACTIVITY_RPC_FUNCTIONS.has(functionName)");
  });

  it("checks role = admin in SQL, revokes anon, and counts only plan reading logs in Taiwan time", () => {
    for (const [suffix, signature] of [
      ["_reading_activity_dau_wau_mau.sql", "admin_get_reading_activity(date, date, uuid)"],
      ["_reading_activity_l7.sql", "admin_get_reading_activity_l7(date, uuid)"],
      ["_reading_hour_heatmap.sql", "admin_get_reading_hour_heatmap(date, date, uuid)"]
    ]) {
      const sql = migration(suffix);
      expect(sql).toContain("IS DISTINCT FROM 'admin'");
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated, service_role;`);
      expect(sql).toContain("l.plan_id IS NOT NULL");
      expect(sql).toContain("'Asia/Taipei'");
    }
  });
});
