import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const context = {
  window: {},
  console,
  Date,
  Map,
  Set,
  JSON,
  Array,
  Number,
  String,
  Object,
  Math
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(readFileSync(join(root, "js", "data", "bible_data.js"), "utf8"), context);
vm.runInContext(readFileSync(join(root, "js", "data", "church_campaign.js"), "utf8"), context);

const campaign = context.window.CHURCH_CAMPAIGN;
const books = context.window.BIBLE_BOOKS;

describe("versioned church Bible campaign", () => {
  it("contains the complete 66-book, 1,189-chapter schedule", () => {
    const result = context.window.validateChurchCampaign(campaign, books);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.chapterCount).toBe(1189);
    expect(campaign.stages).toHaveLength(10);
    expect(new Set(campaign.stages.map(stage => stage.roundNo))).toHaveLength(8);
    expect(campaign.segments).toHaveLength(35);

    const scheduled = context.window.buildChurchCampaignDays(campaign, books)
      .flatMap(day => day.chapters)
      .map(chapter => chapter.book + ":" + chapter.chapter);
    const canonical = books.flatMap(book =>
      Array.from({ length: book.chapters }, (_, index) => book.name + ":" + (index + 1))
    );
    const campaignDays = context.window.buildChurchCampaignDays(campaign, books);
    expect(campaignDays[0].dayNum).toBe(1);
    expect(campaignDays.at(-1).dayNum).toBe(campaignDays.length);
    expect(new Set(campaignDays.map(day => day.dayNum)).size).toBe(campaignDays.length);
    expect(scheduled).toHaveLength(1189);
    expect(new Set(scheduled).size).toBe(1189);
    expect(new Set(scheduled)).toEqual(new Set(canonical));
  });

  it("redistributes every campaign stage around personal weekly rest days", () => {
    const days = context.window.buildChurchCampaignDays(campaign, books, [0, 6]);
    const restDays = days.filter(day => [0, 6].includes(new Date(day.isoDate + "T00:00:00").getDay()));
    expect(restDays.length).toBeGreaterThan(0);
    expect(restDays.every(day => day.isRestDay && day.chapters.length === 0)).toBe(true);
    expect(days.flatMap(day => day.chapters)).toHaveLength(1189);
    expect(days.filter(day => day.chapters.length > 0).every(day => ![0, 6].includes(new Date(day.isoDate + "T00:00:00").getDay()))).toBe(true);
  });

  it("uses profile small-group membership with a six-person minimum and no maximum", () => {
    const five = Array.from({ length: 5 }, () => ({ small_group: "恩典小組" }));
    const six = Array.from({ length: 6 }, () => ({ small_group: "恩典小組" }));
    const twelve = Array.from({ length: 12 }, () => ({ small_group: "恩典小組" }));
    expect(context.window.getChurchCampaignTeamStatus("smallGroup", five, campaign).eligible).toBe(false);
    expect(context.window.getChurchCampaignTeamStatus("smallGroup", six, campaign).eligible).toBe(true);
    const large = context.window.getChurchCampaignTeamStatus("smallGroup", twelve, campaign);
    expect(large.eligible).toBe(true);
    expect(large.max).toBeNull();
    expect(large.source).toBe("profile.small_group");
  });

  it("keeps independent small-home teams between two and four people", () => {
    for (const count of [2, 3, 4]) {
      expect(context.window.getChurchCampaignTeamStatus("smallHome", Array(count).fill({}), campaign).eligible).toBe(true);
    }
    expect(context.window.getChurchCampaignTeamStatus("smallHome", [{}], campaign).eligible).toBe(false);
    expect(context.window.getChurchCampaignTeamStatus("smallHome", Array(5).fill({}), campaign).eligible).toBe(false);
  });

  it("removes the old monthly selection flow while preserving compatibility hiding", () => {
    const state = readFileSync(join(root, "js", "state.js"), "utf8");
    const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");
    const db = readFileSync(join(root, "js", "db.js"), "utf8");
    expect(state).not.toContain("SEASON_MONTHS");
    expect(db).not.toContain('key.startsWith("m_")');
    expect(plan).not.toContain("targetMonth");
    expect(plan).not.toContain("getMonthSeason");
    expect(plan).toContain('String(plan && plan.presetKey || "").startsWith("m_")');
  });
});

describe("campaign data contract and statistics scope", () => {
  const migration = readFileSync(join(root, "supabase", "migrations", "0016_versioned_church_campaign.sql"), "utf8");
  const edge = readFileSync(join(root, "supabase", "functions", "nlc-data", "index.ts"), "utf8");

  it("stores versioned editable rules and synchronizes existing enrollments", () => {
    expect(migration).toContain("plan_rule_versions");
    expect(migration).toContain("publish_global_plan_rules");
    expect(migration).toContain("rule_version");
    expect(migration).toContain("WHERE global_plan_id = p_plan_id");
    expect(migration).toContain("profile.small_group");
  });

  it("lets admins read all church participants while keeping non-admin scope filters", () => {
    expect(edge).toContain("if (isAdmin(profile)) return null");
    expect(edge).toContain('query.in("user_id"');
    expect(edge).toContain('query.in("id"');
    expect(edge).toContain('"publish_global_plan_rules"');
  });
});

describe("editable flexible weekly schedules", () => {
  const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");
  const db = readFileSync(join(root, "js", "db.js"), "utf8");
  const migration = readFileSync(join(root, "supabase", "migrations", "0015_flexible_weekly_schedule.sql"), "utf8");

  it("shows the saved rest weekdays and lets joined users edit them", () => {
    expect(plan).toContain("formatFlexibleScheduleSummary");
    expect(plan).toContain("edit-flexible-schedule-btn");
    expect(plan).toContain("openFlexibleScheduleDialog(plan, { editing: true })");
    expect(plan).toContain("db.updateFlexiblePlanSchedule");
  });

  it("persists the weekly schedule and rebuilds chapter distribution", () => {
    expect(db).toContain("async updateFlexiblePlanSchedule");
    expect(db).toContain("reading_days_per_week: weeklySchedule.readingDaysPerWeek");
    expect(db).toContain("rest_weekdays: weeklySchedule.restWeekdays");
    expect(db).toContain("const rebuilt = generatePlanObject");
    expect(migration).toContain("cardinality(rest_weekdays) = 7 - reading_days_per_week");
  });
});

describe("joined plan options menu", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const stateSource = readFileSync(join(root, "js", "state.js"), "utf8");
  const planSource = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");

  it("shows plan details and exit actions for every joined plan", () => {
    const details = html.indexOf('id="view-plan-details-btn"');
    const exit = html.indexOf('id="delete-plan-btn"');
    expect(details).toBeGreaterThan(-1);
    expect(exit).toBeGreaterThan(details);
    expect(stateSource).toContain('optionsContainer.classList.toggle("hidden", !isPlanDetail)');
    expect(stateSource).toContain('optionsContainer.style.display = isPlanDetail ? "flex" : "none"');
    expect(planSource).toContain("openPlanDetailsDialog(state.activePlan)");
  });

  it("keeps the weekly schedule as a separate action for every plan", () => {
    const details = html.indexOf('id="view-plan-details-btn"');
    const schedule = html.indexOf('id="edit-flexible-plan-schedule-btn"');
    const exit = html.indexOf('id="delete-plan-btn"');
    expect(schedule).toBeGreaterThan(details);
    expect(exit).toBeGreaterThan(schedule);
    expect(html).not.toContain('id="edit-flexible-plan-schedule-btn" style="display:none;"');
    expect(planSource).toContain('if (flexibleScheduleMenuButton) flexibleScheduleMenuButton.style.display = ""');
    expect(planSource).toContain('if (!plan) return;');
  });
});
