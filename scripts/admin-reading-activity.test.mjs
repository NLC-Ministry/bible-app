import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";
import {
  addDays,
  buildActivitySeries,
  buildHourProfile,
  buildL7View,
  chartColors,
  defaultRange,
  formatPct,
  renderAdminReadingActivity,
  summarizeActivity,
  taipeiDateString,
  validateRange
} from "../js/modules/admin-reading-activity.mjs";
import { readLegacyIndexHtml } from "./lib/legacy-markup.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

describe("reading hours (#454)", () => {
  const data = {
    dayCounts: { 1: 2, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
    cells: [
      { dow: 1, hour: 6, sumUsers: 9, sumChapters: 30 },
      { dow: 2, hour: 6, sumUsers: 3, sumChapters: 6 },
      { dow: 6, hour: 21, sumUsers: 4, sumChapters: 12 },
      { dow: 7, hour: 9, sumUsers: 2, sumChapters: 2 }
    ]
  };

  it("averages each hour over the days in the chosen filter, always 24 hours", () => {
    const all = buildHourProfile(data);
    expect(all.hours).toHaveLength(24);
    expect(all.dayCount).toBe(8);
    expect(all.hours[6].value).toBe(1.5); // (9 + 3) ÷ 8 天
    const weekday = buildHourProfile(data, { days: "weekday" });
    expect(weekday.dayCount).toBe(6);
    expect(weekday.hours[6].value).toBe(2); // (9 + 3) ÷ 6 個平日
    expect(weekday.hours[21].value).toBe(0); // 週末的不算進平日
    const weekend = buildHourProfile(data, { days: "weekend", metric: "chapters" });
    expect(weekend.hours[21].value).toBe(6); // 12 章 ÷ 2 個週末日
  });

  it("lists the top three hours by value, skipping empty hours", () => {
    expect(buildHourProfile(data).top.map(item => item.hour)).toEqual([6, 21, 9]);
    expect(buildHourProfile({ cells: [], dayCounts: {} }).top).toEqual([]);
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
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("每天讀經人數（DAU）");
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("近 30 天讀過的人（MAU）");
    expect(doc.querySelector("#admin-reading-activity-l7").textContent).toContain("最多只會到 3 天");
    expect(doc.querySelectorAll("#admin-reading-activity-heatmap tbody tr")).toHaveLength(24);
    vi.unstubAllGlobals();
  });

  it("names the busiest hours in text and switches between all days, weekdays, weekends, people and chapters", async () => {
    const { doc, run } = setup();
    await run();
    const top = () => doc.querySelector(".admin-reading-activity__top").textContent;
    expect(top()).toContain("6 時（平均每天 2 人）");
    doc.querySelector('[data-hour-metric="chapters"]').click();
    expect(top()).toContain("6 時（平均每天 5 章）");
    doc.querySelector('[data-hour-days="weekend"]').click();
    expect(top()).toContain("沒有讀經紀錄");
    expect(doc.querySelector('[data-hour-days="weekend"]').getAttribute("aria-selected")).toBe("true");
    expect(doc.querySelector('[data-hour-metric="chapters"]').getAttribute("aria-selected")).toBe("true");
    vi.unstubAllGlobals();
  });

  it("shows each block's own error without blocking the others, and does not call the server for an invalid range", async () => {
    const { doc, db, run } = setup({ getReadingActivityL7: vi.fn(async () => ({ success: false, message: "只有系統管理員可以查看讀經使用率。" })) });
    await run();
    expect(doc.querySelector("#admin-reading-activity-l7").textContent).toContain("只有系統管理員");
    expect(doc.querySelector("#admin-reading-activity-trend").textContent).toContain("每天讀經人數（DAU）");

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
  const indexHtml = readLegacyIndexHtml();

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
    // 三支後來被 #473（排除個人計畫）改寫過：驗現在的定義（#458）。
    for (const [sql, signature] of [
      [currentMigrationSql("20261007110629_reading_activity_dau_wau_mau.sql"), "admin_get_reading_activity(date, date, uuid)"],
      [currentMigrationSql("20261007110640_reading_activity_l7.sql"), "admin_get_reading_activity_l7(date, uuid)"],
      [currentMigrationSql("20261007110649_reading_hour_heatmap.sql"), "admin_get_reading_hour_heatmap(date, date, uuid)"]
    ]) {
      expect(sql).toContain("IS DISTINCT FROM 'admin'");
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated, service_role;`);
      expect(sql).toContain("l.plan_id IS NOT NULL");
      expect(sql).toContain("'Asia/Taipei'");
    }
  });
});

describe("chart colors follow the theme (#456)", () => {
  it("reads theme tokens from body, where the dark and warm themes define them", () => {
    const dom = new JSDOM(`<style>
      :root { --color-brand: #04A9D2; --color-success-foreground: #1F8F52; --color-warning: #FE7615; --chart-muted: #C2C2C2; }
      body.dark-theme { --color-success-foreground: #7AEAA0; --chart-muted: #5C5C5C; }
    </style><body class="dark-theme"></body>`);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("getComputedStyle", element => dom.window.getComputedStyle(element));
    try {
      expect(chartColors()).toEqual({ brand: "#04A9D2", success: "#7AEAA0", warning: "#FE7615", muted: "#5C5C5C" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defines a solid muted chart color in every theme", () => {
    const css = read("index.css");
    for (const selector of [":root", "body.dark-theme", "body.warm-theme"]) {
      const start = css.indexOf(`${selector} {`);
      const block = css.slice(start, css.indexOf("}", start));
      expect(block, selector).toMatch(/--chart-muted:\s*#[0-9A-Fa-f]{6};/);
    }
  });
});
