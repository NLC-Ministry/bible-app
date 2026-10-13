// #564：進度規則的本體搬到 supabase/functions/_shared/progress/，伺服器和會友 App 執行同一份。
// 這裡檢查：App 的舊路徑真的轉出同一份函式、書卷表兩份一致、伺服器從 global_plans 一列推出的
// 計畫欄位與比對尺和 App 的 mapGlobalPlanRecord／getCanonicalStageScheduleDays 相同。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import * as appMetrics from "../js/modules/pastoral-metrics.mjs";
import * as appSchedule from "../js/data/schedule-progress.mjs";
import * as appRound from "../js/data/current-round-progress.mjs";
import * as sharedProgress from "../supabase/functions/_shared/progress/plan-progress.mjs";
import * as sharedSchedule from "../supabase/functions/_shared/progress/schedule-progress.mjs";
import { getConfirmedReadingRound } from "../supabase/functions/_shared/progress/reading-round.mjs";
import { BIBLE_BOOK_CHAPTERS } from "../supabase/functions/_shared/progress/bible-chapters.mjs";
import {
  CHURCH_CAMPAIGN,
  buildChurchCampaignDays,
  createChurchCampaignStageDefinitions
} from "../supabase/functions/_shared/progress/church-campaign.mjs";
import {
  buildEvenScheduleDays,
  buildGlobalPlanBaseline,
  distributeChaptersAcrossDays,
  expandPlanBooksToChapters,
  globalPlanScheduleFields,
  resolveGlobalPlanCampaign
} from "../supabase/functions/_shared/progress/plan-schedule.mjs";

const appBooks = (() => {
  const context = { window: {} };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(readFileSync("js/data/bible_data.js", "utf8"), context);
  return context.window.BIBLE_BOOKS;
})();

const chapterCounts = (days) => days.map((day) => day.chapters.length);

describe("App 的舊路徑轉出伺服器同一份程式", () => {
  it("pastoral-metrics、schedule-progress、current-round-progress 是同一批函式", () => {
    for (const name of ["describePerson", "buildPlanContext", "summarizeFunnel", "countBuckets", "countCareReasons", "compareUnits", "pickUnitLevel"]) {
      expect(appMetrics[name]).toBe(sharedProgress[name]);
    }
    for (const name of Object.keys(sharedSchedule)) expect(appSchedule[name]).toBe(sharedSchedule[name]);
    expect(appRound.getConfirmedReadingRound).toBe(getConfirmedReadingRound);
  });

  it("App 不再自己定義平均分配與書卷展開", () => {
    const utils = readFileSync("js/utils.js", "utf8");
    expect(utils).not.toMatch(/\nfunction distributeChaptersAcrossDays\(/);
    expect(utils).toContain("expandPlanBooksToChapters(booksToUse, BIBLE_BOOKS)");
    const campaign = readFileSync("js/data/church_campaign.js", "utf8");
    expect(campaign).not.toMatch(/\nconst CHURCH_CAMPAIGN = \{/);
  });
});

describe("書卷表", () => {
  it("伺服器的 66 卷書名與章數和 bible_data.js 一模一樣", () => {
    expect(BIBLE_BOOK_CHAPTERS.map(({ name, chapters }) => [name, chapters]))
      .toEqual(appBooks.map(({ name, chapters }) => [name, chapters]));
  });
});

describe("global_plans 一列 → 計畫欄位與比對尺（同 mapGlobalPlanRecord）", () => {
  const stages = createChurchCampaignStageDefinitions(CHURCH_CAMPAIGN);
  const stage1 = stages.find((stage) => stage.stageNo === 1);
  const september = stages.find((stage) => stage.presetKey === "church_r1final_2026_09");

  it("正式階段有存規則：用存的定義，起訖、書卷、代號都來自定義", () => {
    const row = { id: stage1.id, name: "x", plan_kind: "church_campaign_stage", rules: stage1, target_books: [], start_date: "2000-01-01", end_date: "2000-01-02" };
    const fields = globalPlanScheduleFields(row);
    expect(fields).toEqual({ startDate: "2026-08-01", endDate: "2026-08-31", books: ["創世記"], presetKey: "church_stage_01" });
    const { baselineDays } = buildGlobalPlanBaseline(row);
    expect(chapterCounts(baselineDays)).toEqual(chapterCounts(buildChurchCampaignDays(stage1, appBooks, [])));
    expect(baselineDays.reduce((sum, day) => sum + day.chapters.length, 0)).toBe(50);
  });

  it("正式階段沒存規則：id 尾碼就是階段序，退回內建定義", () => {
    const row = { id: stage1.id, plan_kind: "church_campaign_stage", rules: {}, target_books: [] };
    expect(resolveGlobalPlanCampaign(row).campaignDefinition.presetKey).toBe("church_stage_01");
  });

  it("月度期末賽：用存的定義（c126 id）", () => {
    const row = { id: september.id, plan_kind: "church_campaign_stage", rules: september, target_books: ["出埃及記"] };
    const { plan, baselineDays } = buildGlobalPlanBaseline(row);
    expect(plan.presetKey).toBe("church_r1final_2026_09");
    expect(baselineDays).toHaveLength(30);
    expect(baselineDays.reduce((sum, day) => sum + day.chapters.length, 0)).toBe(40);
  });

  it("延後大區梯次：不掛活動定義，經卷平均鋪在自己的起訖，代號取 rules.presetKey", () => {
    const row = {
      id: "11111111-2222-3333-4444-555555555555",
      plan_kind: "church_campaign_stage_cohort",
      rules: { stageNo: 2, presetKey: "church_r1final_taoyuan_2026_10" },
      target_books: ["出埃及記"],
      start_date: "2026-10-01",
      end_date: "2026-10-31"
    };
    const resolved = resolveGlobalPlanCampaign(row);
    expect(resolved.campaignDefinition).toBeNull();
    expect(resolved.cohortStageNo).toBe(2);
    const { plan, baselineDays } = buildGlobalPlanBaseline(row);
    expect(plan.presetKey).toBe("church_r1final_taoyuan_2026_10");
    expect(plan.startDate).toBe("2026-10-01");
    expect(baselineDays).toHaveLength(31);
    // 40 章 ÷ 31 天：前 9 天各 2 章，其餘各 1 章
    expect(chapterCounts(baselineDays)).toEqual([...Array(9).fill(2), ...Array(22).fill(1)]);
  });

  it("App 的 mapGlobalPlanRecord 實際跑起來，計畫欄位和伺服器推出的一樣", () => {
    const db = readFileSync("js/db.js", "utf8").replace(/\r\n/g, "\n");
    const start = db.indexOf("function mapGlobalPlanRecord(dbPlan) {");
    expect(start).toBeGreaterThan(0);
    const source = db.slice(start, db.indexOf("\n}\n", start) + 3);
    const window = { CHURCH_CAMPAIGN };
    // eslint-disable-next-line no-new-func
    const mapGlobalPlanRecord = new Function(
      "window", "resolveGlobalPlanCampaign", "globalPlanScheduleFields", "normalizeGraceDays",
      `${source}\nreturn mapGlobalPlanRecord;`
    )(window, resolveGlobalPlanCampaign, globalPlanScheduleFields, (value) => value ?? 0);
    const rows = [
      { id: stage1.id, name: "x", plan_kind: "church_campaign_stage", rules: stage1, target_books: [] },
      { id: "11111111-2222-3333-4444-555555555555", name: "桃園", plan_kind: "church_campaign_stage_cohort",
        rules: { stageNo: 2, presetKey: "church_r1final_taoyuan_2026_10" }, target_books: ["出埃及記"],
        start_date: "2026-10-01", end_date: "2026-10-31" },
      { id: "22222222-2222-3333-4444-555555555555", name: "自訂", plan_kind: "standard", rules: null,
        target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21" }
    ];
    for (const row of rows) {
      const mapped = mapGlobalPlanRecord(row);
      const { plan } = buildGlobalPlanBaseline(row);
      expect({ startDate: mapped.startDate, endDate: mapped.endDate, books: mapped.books, presetKey: mapped.presetKey })
        .toEqual({ startDate: plan.startDate, endDate: plan.endDate, books: plan.books, presetKey: plan.presetKey });
    }
    expect(mapGlobalPlanRecord(rows[0]).stageNo).toBe(1);
    expect(mapGlobalPlanRecord(rows[1]).awardName).toBe("鐵獎");
  });

  it("一般計畫的平均分配＝generatePlanObject 不帶個人設定時用的兩個函式", () => {
    const books = ["路得記", "詩篇 111-150"];
    const days = buildEvenScheduleDays({ startDate: "2026-11-01", endDate: "2026-11-10", books });
    const expected = distributeChaptersAcrossDays(expandPlanBooksToChapters(books), 10);
    expect(days.map((day) => day.chapters.map((ch) => `${ch.book}${ch.chapter}`)))
      .toEqual(expected.map((day) => day.map((ch) => `${ch.book}${ch.chapter}`)));
    expect(days.reduce((sum, day) => sum + day.chapters.length, 0)).toBe(4 + 40);
  });
});

describe("兩個互斥條件", () => {
  const ctx = sharedProgress.buildPlanContext({
    plan: { startDate: "2026-10-01" },
    baselineDays: buildEvenScheduleDays({ startDate: "2026-10-01", endDate: "2026-10-31", books: ["利未記"] }),
    bibleBooks: BIBLE_BOOK_CHAPTERS,
    today: "2026-10-13"
  });
  const enrolled = (chapters, lastReadAt, extra = {}) => ({
    id: `p${chapters}-${lastReadAt}`, name: "x",
    enrollment: { round: 1, books: ["利未記"], chapters, byRound: { 1: chapters }, maxRound: chapters ? 1 : null, lastReadAt, readDays7: 0, ...extra }
  });

  it("落後從 2 天起算；只差 1 天（今日未完成）算跟上", () => {
    // 27 章 ÷ 31 天：前 27 天各 1 章，10/13 應讀到第 13 天
    const pending = sharedProgress.describePerson(enrolled(12, "2026-10-13T01:00:00Z"), ctx);
    expect(pending.status).toBe("today_pending");
    expect(pending.progressBucket).toBe("on_track");
    expect(pending.onTrack).toBe(true);
    expect(sharedProgress.describePerson(enrolled(11, "2026-10-13T01:00:00Z"), ctx).progressBucket).toBe("behind");
    expect(sharedProgress.describePerson(enrolled(6, "2026-10-13T01:00:00Z"), ctx).progressBucket).toBe("behind_long");
    expect(sharedProgress.describePerson({ id: "n", name: "n", enrollment: null }, ctx).progressBucket).toBe("not_enrolled");
  });

  it("最後打卡：今天、1–2 天前、3–6 天前、7 天以上、沒有紀錄", () => {
    const bucket = (at) => sharedProgress.describePerson(enrolled(13, at), ctx).checkinBucket;
    expect(bucket("2026-10-12T17:00:00Z")).toBe("today"); // 台北 10/13 01:00
    expect(bucket("2026-10-11T03:00:00Z")).toBe("recent");
    expect(bucket("2026-10-10T03:00:00Z")).toBe("lapsed");
    expect(bucket("2026-10-06T03:00:00Z")).toBe("dormant");
    expect(sharedProgress.describePerson(enrolled(0, null), ctx).checkinBucket).toBe("none");
  });
});
