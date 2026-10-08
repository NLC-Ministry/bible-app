import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";
import {
  buildOverviewCsv,
  buildRegionCsv,
  buildZoneCsv,
  filterAttempts,
  rankAttempts,
  formatElapsedSeconds,
  sortZoneRowsByRegion,
  summarizeByRegion,
  summarizeByZone
} from "../js/modules/lightning-quiz-analytics.mjs";

const EXPORTED_AT = new Date("2026-09-25T02:00:00Z");

const results = {
  attempts: [
    { name: "王小明", greatRegion: "北區", pastoralZone: "信義牧區", smallGroup: "A 組", regionSort: 1, zoneSort: 2, status: "correct", elapsedMs: 4200, completedAt: "2026-09-25T01:00:05Z" },
    { name: "李小華", greatRegion: "北區", pastoralZone: "信義牧區", smallGroup: "B 組", regionSort: 1, zoneSort: 2, status: "wrong", elapsedMs: 9100, completedAt: "2026-09-25T01:02:00Z" },
    { name: "陳大同", greatRegion: "北區", pastoralZone: "大安牧區", smallGroup: "C 組", regionSort: 1, zoneSort: 1, status: "in_progress", elapsedMs: null, completedAt: null },
    { name: "林\"引號\"", greatRegion: "南區", pastoralZone: "前鎮牧區", smallGroup: "", regionSort: 2, zoneSort: 1, status: "correct", elapsedMs: 3000, completedAt: "2026-09-25T01:01:00Z" },
    { name: "未分配者", greatRegion: "", pastoralZone: "", smallGroup: "", regionSort: null, zoneSort: null, status: "correct", elapsedMs: 5000, completedAt: "2026-09-25T01:03:00Z" }
  ],
  eligible: [
    { greatRegion: "北區", pastoralZone: "信義牧區", regionSort: 1, zoneSort: 2, count: 10 },
    { greatRegion: "北區", pastoralZone: "大安牧區", regionSort: 1, zoneSort: 1, count: 5 },
    { greatRegion: "南區", pastoralZone: "前鎮牧區", regionSort: 2, zoneSort: 1, count: 4 },
    { greatRegion: "南區", pastoralZone: "小港牧區", regionSort: 2, zoneSort: 2, count: 0 },
    { greatRegion: "", pastoralZone: "", regionSort: null, zoneSort: null, count: 1 }
  ]
};

describe("summarizeByZone", () => {
  const { rows, total } = summarizeByZone(results);
  const byZone = Object.fromEntries(rows.map(row => [row.pastoralZone, row]));

  it("counts completed attempts only, keeping in-progress out of the answer rate", () => {
    expect(byZone["信義牧區"]).toMatchObject({ eligible: 10, completed: 2, correct: 1, inProgress: 0 });
    expect(byZone["信義牧區"].participationRate).toBeCloseTo(0.2);
    expect(byZone["信義牧區"].correctRate).toBeCloseTo(0.5);
    expect(byZone["大安牧區"]).toMatchObject({ eligible: 5, completed: 0, inProgress: 1 });
    expect(byZone["大安牧區"].correctRate).toBeNull();
  });

  it("guards divide-by-zero on zones with no eligible members", () => {
    expect(byZone["小港牧區"].participationRate).toBeNull();
    expect(byZone["小港牧區"].correctRate).toBeNull();
  });

  it("puts unassigned members last and totals the whole church", () => {
    expect(rows[rows.length - 1].pastoralZone).toBe("");
    expect(total).toMatchObject({ eligible: 20, completed: 4, correct: 3, inProgress: 1 });
    expect(total.participationRate).toBeCloseTo(0.2);
    expect(total.correctRate).toBeCloseTo(0.75);
  });

  it("orders zones by region then by the org's sort_order", () => {
    expect(sortZoneRowsByRegion(rows).map(row => row.pastoralZone))
      .toEqual(["大安牧區", "信義牧區", "前鎮牧區", "小港牧區", ""]);
  });
});

describe("summarizeByRegion", () => {
  it("aggregates zones into regions with the same totals", () => {
    const { rows, total } = summarizeByRegion(results);
    expect(rows.map(row => row.greatRegion)).toEqual(["北區", "南區", ""]);
    expect(rows[0]).toMatchObject({ eligible: 15, completed: 2, correct: 1, inProgress: 1 });
    expect(rows[1]).toMatchObject({ eligible: 4, completed: 1, correct: 1 });
    expect(total).toMatchObject({ eligible: 20, completed: 4, correct: 3 });
  });

  it("handles an empty payload", () => {
    const { rows, total } = summarizeByRegion({});
    expect(rows).toEqual([]);
    expect(total.participationRate).toBeNull();
  });
});

describe("rankAttempts (#316)", () => {
  it("ranks only correct answers, fastest first, keeping the original order", () => {
    const ranked = rankAttempts(results.attempts);
    expect(ranked.map(a => a.rank)).toEqual([2, null, null, 1, 3]);
    expect(ranked.map(a => a.name)).toEqual(results.attempts.map(a => a.name));
  });

  it("gives identical times the same rank", () => {
    const ranked = rankAttempts([
      { name: "甲", status: "correct", elapsedMs: 3000 },
      { name: "乙", status: "correct", elapsedMs: 3000 },
      { name: "丙", status: "correct", elapsedMs: 4000 }
    ]);
    expect(ranked.map(a => a.rank)).toEqual([1, 1, 3]);
  });

  it("filtering keeps each person's overall rank", () => {
    const ranked = rankAttempts(results.attempts);
    expect(filterAttempts(ranked, { search: "王小明" }).map(a => a.rank)).toEqual([2]);
  });
});

describe("filterAttempts", () => {
  it("filters by status and searches name / zone / group", () => {
    expect(filterAttempts(results.attempts, { status: "correct" })).toHaveLength(3);
    expect(filterAttempts(results.attempts, { search: "信義" }).map(a => a.name)).toEqual(["王小明", "李小華"]);
    expect(filterAttempts(results.attempts, { search: "c 組" }).map(a => a.name)).toEqual(["陳大同"]);
  });
});

describe("CSV builders", () => {
  const lines = csv => csv.split("\n");

  it("overview CSV has the export-time line, seconds, labels and escaped quotes", () => {
    const csv = lines(buildOverviewCsv(rankAttempts(results.attempts), EXPORTED_AT));
    expect(csv[0]).toContain("匯出時間（台灣時間）");
    expect(csv[1]).toBe('"名次","姓名","大區","牧區","小組","結果","作答時間（秒）","送出時間"');
    expect(csv[2]).toMatch(/^"2","王小明","北區","信義牧區","A 組","答對","4\.2",".*2026-09-25 09:00"$/);
    expect(csv[3]).toMatch(/^"","李小華",/);
    expect(csv[4]).toBe('"","陳大同","北區","大安牧區","C 組","未完成","",""');
    expect(csv[5]).toContain('"林""引號"""');
    expect(csv[6]).toContain('"未分配大區","未分配牧區"');
  });

  it("zone and region CSVs end with the church-wide total", () => {
    const zone = lines(buildZoneCsv(summarizeByZone(results), EXPORTED_AT));
    expect(zone[1]).toBe('"大區","牧區","應答人數","作答人數","參與率","答對人數","答對率"');
    expect(zone[2]).toBe('"北區","大安牧區","5","0","0.0%","0",""');
    expect(zone.at(-1)).toBe('"全教會合計","","20","4","20.0%","3","75.0%"');

    const region = lines(buildRegionCsv(summarizeByRegion(results), EXPORTED_AT));
    expect(region[1]).toBe('"大區","應答人數","作答人數","參與率","答對人數","答對率"');
    expect(region.at(-1)).toBe('"全教會合計","20","4","20.0%","3","75.0%"');
  });

  it("formats elapsed time in seconds with one decimal", () => {
    expect(formatElapsedSeconds(12345)).toBe("12.3");
    expect(formatElapsedSeconds(null)).toBe("");
  });
});

describe("wiring", () => {
  const migration = currentMigrationSql("0210_lightning_quiz_results_analytics.sql");
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");

  it("the new RPC is admin-gated and never PUBLIC-executable", () => {
    expect(migration).toContain("_lightning_quiz_actor_is_admin(actor_id)");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.admin_get_lightning_quiz_results(uuid, int, uuid) FROM PUBLIC;");
  });

  it("nlc-data allows the new RPC", () => {
    expect(nlcData).toContain('"admin_get_lightning_quiz_results"');
  });
});
