import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addDays,
  buildWeekLeaderboard,
  buildWeekMembersCsv,
  buildWeekRegionCsv,
  buildWeekZoneCsv,
  buildWeeklyTrendCsv,
  buildWeeklyTrendSeries,
  formatWeekRange,
  formatWeekday,
  sortZoneRowsByRegion,
  summarizeWeek,
  summarizeWeekByRegion,
  summarizeWeekByZone,
  weekStartOf
} from "../js/modules/lightning-quiz-analytics.mjs";

// #311：雲柱測驗週統計（週一到週日，一週一三五 3 題）
const EXPORTED_AT = new Date("2026-09-28T02:00:00Z");

const week = {
  weekStart: "2026-09-21",
  weekEnd: "2026-09-27",
  questions: [
    { questionId: "q1", riseDate: "2026-09-21", completedCount: 3, correctCount: 2 },
    { questionId: "q2", riseDate: "2026-09-23", completedCount: 2, correctCount: 2 },
    { questionId: "q3", riseDate: "2026-09-25", completedCount: 1, correctCount: 0 }
  ],
  members: [
    { userId: "u1", name: "王小明", greatRegion: "北區", pastoralZone: "信義牧區", smallGroup: "A 組", regionSort: 1, zoneSort: 2, answered: 3, correct: 2, correctElapsedMs: 8000 },
    { userId: "u2", name: "李小華", greatRegion: "北區", pastoralZone: "大安牧區", smallGroup: "B 組", regionSort: 1, zoneSort: 1, answered: 2, correct: 2, correctElapsedMs: 6000 },
    { userId: "u3", name: "陳大同", greatRegion: "南區", pastoralZone: "前鎮牧區", smallGroup: "", regionSort: 2, zoneSort: 1, answered: 1, correct: 0, correctElapsedMs: 0 }
  ],
  eligible: [
    { greatRegion: "北區", pastoralZone: "信義牧區", regionSort: 1, zoneSort: 2, count: 10 },
    { greatRegion: "北區", pastoralZone: "大安牧區", regionSort: 1, zoneSort: 1, count: 5 },
    { greatRegion: "南區", pastoralZone: "前鎮牧區", regionSort: 2, zoneSort: 1, count: 4 },
    { greatRegion: "", pastoralZone: "", regionSort: null, zoneSort: null, count: 1 }
  ]
};

describe("week dates", () => {
  it("finds the Monday of any date, including Sunday and across months", () => {
    expect(weekStartOf("2026-09-21")).toBe("2026-09-21");
    expect(weekStartOf("2026-09-27")).toBe("2026-09-21");
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28");
    expect(addDays("2026-09-28", -7)).toBe("2026-09-21");
  });

  it("formats a week range and weekday labels", () => {
    expect(formatWeekRange("2026-09-28")).toBe("9/28～10/4");
    expect(formatWeekday("2026-09-23")).toBe("9/23（三）");
  });
});

describe("summarizeWeek", () => {
  it("counts people (not answers) for participation, and all-answered against the week's question count", () => {
    const summary = summarizeWeek(week);
    expect(summary).toMatchObject({ questionCount: 3, eligible: 20, participants: 3, allAnswered: 1, completed: 6, correct: 4 });
    expect(summary.participationRate).toBeCloseTo(0.15);
    expect(summary.correctRate).toBeCloseTo(4 / 6);
    expect(summary.avgCorrectElapsedMs).toBe(3500);
  });

  it("handles an empty week", () => {
    const summary = summarizeWeek({});
    expect(summary).toMatchObject({ questionCount: 0, participants: 0, allAnswered: 0 });
    expect(summary.participationRate).toBeNull();
    expect(summary.avgCorrectElapsedMs).toBeNull();
  });
});

describe("summarizeWeekByZone / ByRegion", () => {
  it("breaks down participation per zone, ordered by region then zone, unassigned last", () => {
    const { rows, total } = summarizeWeekByZone(week);
    expect(sortZoneRowsByRegion(rows).map(row => row.pastoralZone)).toEqual(["大安牧區", "信義牧區", "前鎮牧區", ""]);
    const byZone = Object.fromEntries(rows.map(row => [row.pastoralZone, row]));
    expect(byZone["信義牧區"]).toMatchObject({ eligible: 10, participants: 1, allAnswered: 1 });
    expect(byZone["大安牧區"]).toMatchObject({ eligible: 5, participants: 1, allAnswered: 0 });
    expect(byZone[""].participationRate).toBe(0);
    expect(total).toMatchObject({ eligible: 20, participants: 3, allAnswered: 1 });
  });

  it("aggregates into regions with the same totals", () => {
    const { rows, total } = summarizeWeekByRegion(week);
    expect(rows.map(row => row.greatRegion)).toEqual(["北區", "南區", ""]);
    expect(rows[0]).toMatchObject({ eligible: 15, participants: 2, allAnswered: 1, completed: 5, correct: 4 });
    expect(total.correctRate).toBeCloseTo(4 / 6);
  });
});

describe("buildWeekLeaderboard", () => {
  it("ranks by correct answers, then by total time on correct answers; members with no correct answer are left out", () => {
    const board = buildWeekLeaderboard(week);
    expect(board.map(entry => [entry.rank, entry.name])).toEqual([[1, "李小華"], [2, "王小明"]]);
  });

  it("gives tied members the same rank and respects the limit", () => {
    const tied = {
      members: [
        { userId: "a", name: "甲", correct: 3, correctElapsedMs: 9000 },
        { userId: "b", name: "乙", correct: 3, correctElapsedMs: 9000 },
        { userId: "c", name: "丙", correct: 2, correctElapsedMs: 1000 }
      ]
    };
    expect(buildWeekLeaderboard(tied).map(entry => entry.rank)).toEqual([1, 1, 3]);
    expect(buildWeekLeaderboard(tied, 2)).toHaveLength(2);
  });
});

describe("buildWeeklyTrendSeries", () => {
  it("turns weekly RPC rows into sorted points with rates", () => {
    const series = buildWeeklyTrendSeries([
      { weekStart: "2026-09-28", questionCount: 3, participants: 40, allAnswered: 10, completedAttempts: 90, correctAttempts: 45, avgElapsedMs: 6000, totalEligible: 200 },
      { weekStart: "2026-09-21", questionCount: 3, participants: 20, allAnswered: 5, completedAttempts: 50, correctAttempts: 40, avgElapsedMs: null, totalEligible: 200 }
    ]);
    expect(series.map(point => point.weekStart)).toEqual(["2026-09-21", "2026-09-28"]);
    expect(series[1]).toMatchObject({ label: "9/28～10/4", participants: 40, completed: 90, correct: 45 });
    expect(series[1].participationRate).toBeCloseTo(0.2);
    expect(series[1].correctRate).toBeCloseTo(0.5);
    expect(series[0].avgElapsedMs).toBeNull();
  });
});

describe("weekly CSV builders", () => {
  const lines = csv => csv.split("\n");

  it("members CSV lists everyone who answered, in leaderboard order, with ranks only for those who got one right", () => {
    const csv = lines(buildWeekMembersCsv(week, EXPORTED_AT));
    expect(csv[0]).toContain("匯出時間（台灣時間）");
    expect(csv[1]).toBe('"名次","姓名","大區","牧區","小組","送出題數（共 3 題）","答對題數","答對總用時（秒）"');
    expect(csv[2]).toBe('"1","李小華","北區","大安牧區","B 組","2","2","6.0"');
    expect(csv[3]).toBe('"2","王小明","北區","信義牧區","A 組","3","2","8.0"');
    expect(csv[4]).toBe('"","陳大同","南區","前鎮牧區","","1","0",""');
  });

  it("zone and region CSVs end with the church-wide total", () => {
    const zone = lines(buildWeekZoneCsv(summarizeWeekByZone(week), EXPORTED_AT));
    expect(zone[1]).toBe('"大區","牧區","應答人數","參與人數","參與率","全部答完","答對率"');
    expect(zone.at(-1)).toBe('"全教會合計","","20","3","15.0%","1","66.7%"');
    const region = lines(buildWeekRegionCsv(summarizeWeekByRegion(week), EXPORTED_AT));
    expect(region.at(-1)).toBe('"全教會合計","20","3","15.0%","1","66.7%"');
  });

  it("trend CSV lists each week", () => {
    const series = buildWeeklyTrendSeries([
      { weekStart: "2026-09-21", questionCount: 3, participants: 20, allAnswered: 5, completedAttempts: 50, correctAttempts: 40, avgElapsedMs: 6000, totalEligible: 200 }
    ]);
    expect(lines(buildWeeklyTrendCsv(series, EXPORTED_AT))[2])
      .toBe('"2026-09-21","3","20","200","10.0%","5","40","50","80.0%","6.0"');
  });
});

describe("wiring", () => {
  const migration = readFileSync("supabase/migrations/20260927120147_lightning_quiz_weekly_stats.sql", "utf8");
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
  const db = readFileSync("js/db.js", "utf8");

  it("both RPCs are admin-gated and revoked from PUBLIC/anon before granting", () => {
    for (const sig of ["admin_get_lightning_quiz_weeks(date, date, uuid)", "admin_get_lightning_quiz_week(date, uuid)"]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated, service_role;`);
    }
    expect(migration.split("_lightning_quiz_actor_is_admin(actor_id)").length - 1).toBe(2);
  });

  it("counts only submitted answers on questions members could take", () => {
    expect(migration.split("status NOT IN ('draft', 'archived')").length - 1).toBe(2);
    expect(migration).toContain("a.completed_at IS NOT NULL");
    expect(migration).toContain("date_trunc('week'");
  });

  it("nlc-data and db.js expose both RPCs", () => {
    expect(nlcData).toContain('"admin_get_lightning_quiz_weeks"');
    expect(nlcData).toContain('"admin_get_lightning_quiz_week"');
    expect(db).toContain('_callLightningQuizRpc("admin_get_lightning_quiz_weeks"');
    expect(db).toContain('_callLightningQuizRpc("admin_get_lightning_quiz_week", { p_week_start: weekStart })');
  });
});
