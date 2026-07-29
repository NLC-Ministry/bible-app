import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAlreadyJoinedTeamResult,
  resetPlanTeamInvitePanelState,
  resolveTeamJoinEffectivePlan
} from "../js/modules/plan-team-navigation-helpers.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, "index.html"), "utf8");
const css = readFileSync(join(root, "index.css"), "utf8");
const db = readFileSync(join(root, "js", "db.js"), "utf8");
const plan = readFileSync(join(root, "js", "modules", "plan.js"), "utf8");
const app = readFileSync(join(root, "js", "app.js"), "utf8");

describe("plan primary navigation", () => {
  it("places the four primary views in task-priority order above the content", () => {
    const progress = html.indexOf('data-plan-primary-view="progress"');
    const personal = html.indexOf('data-plan-primary-view="personal"');
    const stats = html.indexOf('data-plan-primary-view="stats"');
    const ranking = html.indexOf('data-plan-primary-view="ranking"');
    expect(progress).toBeGreaterThan(-1);
    expect(progress).toBeLessThan(personal);
    expect(personal).toBeLessThan(stats);
    expect(stats).toBeLessThan(ranking);
  });

  it("keeps personal statistics in the plan and removes the duplicate profile card", () => {
    expect(html).toContain('data-plan-primary-view="personal"');
    expect(html).toContain('id="stats-personal-section"');
    expect(html).not.toContain('id="profile-personal-stats-card"');
    expect(html).not.toContain('id="profile-personal-stats-container"');
  });

  it("removes the old bottom pill row from the visual and accessibility trees", () => {
    expect(html).toContain('class="status-pills-row plan-detail-tabs hidden" aria-hidden="true" style="display: none;"');
    expect(css).toContain('.plan-detail-tabs { display: none !important; }');
  });

  it("uses a sticky four-column, touch-accessible tab strip", () => {
    expect(css).toContain("position: sticky");
    expect(css).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(css).toContain("min-height: 44px");
  });

  it("routes every primary tab through one controller and nests member status in group statistics", () => {
    expect(plan).toContain("async switchPrimaryView(view, options = {})");
    expect(plan).toContain("updatePlanPrimaryTabs(target)");
    expect(plan).toContain("stats.insertBefore(members, stats.firstChild)");
    expect(plan).not.toContain("data-plan-page-index");
  });

  it("labels the team-enabled plan primary tab as team rather than statistics", () => {
    expect(plan).toContain('statsTab.textContent = "團隊"');
    expect(plan).toContain('statsTab.textContent = "團體統計"');
    expect(plan).not.toContain('statsTab.textContent = "團隊統計"');
  });
});

describe("plan join navigation", () => {
  it("previews an available plan and exposes solo and team participation actions", () => {
    const presetFlow = plan.slice(
      plan.indexOf("function renderPresetPlansList"),
      plan.indexOf("function isChapterReadForRound")
    );

    expect(presetFlow).toContain("openPlanDetailsDialog(plan, { onJoin: async () => {");
    expect(presetFlow).toContain("joinPlanSoloFromCard(plan, key)");
    expect(presetFlow).toContain("createTeamFromPlanCard(plan, key)");
    expect(presetFlow).not.toContain("openJoinModeDialog(plan)");
    expect(presetFlow.indexOf("openPlanDetailsDialog")).toBeLessThan(presetFlow.indexOf("joinPlanSoloFromCard(plan, key)"));
  });

  it("opens the joined plan detail instead of returning to the home page", () => {
    const joinFlow = db.slice(
      db.indexOf("async joinPresetPlan"),
      db.indexOf("async joinPlan(", db.indexOf("async joinPresetPlan"))
    );

    expect(joinFlow).toContain('state.planDetailOpen = true');
    expect(joinFlow).toContain('window.currentPlanViewState = "DETAIL"');
    expect(joinFlow).toContain('await appRouter.switchTab("plan-view", { keepPlanDetail: true })');
    expect(joinFlow).not.toContain('switchTab("dashboard-view")');
  });

  it("routes onboarding plan actions to discoverable plans or active progress", () => {
    expect(app).toContain('options.onboardingPlanDestination === "active-progress"');
    expect(app).toContain('options.onboardingPlanDestination === "discover"');
    expect(plan).toContain("async function showDiscoverPlans");
    expect(plan).toContain('document.querySelector(\'#plan-list-status-pills .pill-btn[data-filter="saved"]\')?.click()');
    expect(plan).toContain("window.showDiscoverPlans = showDiscoverPlans");
  });
});

describe("plan team invite navigation helpers", () => {
  it("recognizes already-joined team results from structured and fallback values", () => {
    expect(isAlreadyJoinedTeamResult({ error: { code: "already_in_plan_division" } })).toBe(true);
    expect(isAlreadyJoinedTeamResult({ code: "already_in_plan_team" })).toBe(true);
    expect(isAlreadyJoinedTeamResult({ error: "already_in_plan_division" })).toBe(true);
    expect(isAlreadyJoinedTeamResult({ message: "你已加入這個人數組別的團隊。" })).toBe(true);
    expect(isAlreadyJoinedTeamResult({ error: { code: "reading_team_full" }, message: "這個團隊已額滿。" })).toBe(false);
  });

  it("returns a matching joined plan without auto-joining it again", async () => {
    const matchingPlan = { id: "global-plan", presetKey: "summer-plan" };
    const joinPlan = vi.fn();

    const effectivePlan = await resolveTeamJoinEffectivePlan({
      teamJoinResult: { success: true },
      matchingPlan,
      activePlans: [{ id: "reading-plan", presetKey: "summer-plan" }],
      joinPlan
    });

    expect(effectivePlan).toBe(matchingPlan);
    expect(joinPlan).not.toHaveBeenCalled();
  });

  it("returns the auto-joined plan when team joining succeeds", async () => {
    const matchingPlan = { id: "global-plan" };
    const joinedPlan = { id: "reading-plan", globalPlanId: "global-plan" };
    const joinPlan = vi.fn().mockResolvedValue(joinedPlan);

    const effectivePlan = await resolveTeamJoinEffectivePlan({
      teamJoinResult: { success: true },
      matchingPlan,
      activePlans: [],
      joinPlan
    });

    expect(effectivePlan).toBe(joinedPlan);
    expect(joinPlan).toHaveBeenCalledWith(matchingPlan);
  });

  it("returns failure when automatic plan joining fails", async () => {
    const joinPlan = vi.fn().mockResolvedValue(null);

    const effectivePlan = await resolveTeamJoinEffectivePlan({
      teamJoinResult: { success: true },
      matchingPlan: { id: "global-plan" },
      activePlans: [],
      joinPlan
    });

    expect(effectivePlan).toBeNull();
  });

  it("retries plan participation after an already-in-team result", async () => {
    const joinedPlan = { id: "reading-plan", globalPlanId: "global-plan" };
    const joinPlan = vi.fn().mockResolvedValue(joinedPlan);

    const effectivePlan = await resolveTeamJoinEffectivePlan({
      teamJoinResult: { success: false, error: { code: "already_in_plan_division" } },
      matchingPlan: { id: "global-plan" },
      activePlans: [],
      joinPlan
    });

    expect(effectivePlan).toBe(joinedPlan);
    expect(joinPlan).toHaveBeenCalledOnce();
  });

  it("resets the invite panel and restores focus to its trigger", () => {
    const dom = new JSDOM(`
      <section id="invite-panel"></section>
      <button id="invite-trigger" aria-expanded="true">Open</button>
      <button id="active-filter">Mine</button>
    `);
    const panel = dom.window.document.getElementById("invite-panel");
    const trigger = dom.window.document.getElementById("invite-trigger");
    const target = dom.window.document.getElementById("active-filter");
    const clickHandler = vi.fn();
    target.addEventListener("click", clickHandler);

    resetPlanTeamInvitePanelState({ panel, trigger, target, restoreFocus: true });

    expect(panel.classList.contains("hidden")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(clickHandler).toHaveBeenCalledOnce();
    expect(dom.window.document.activeElement).toBe(trigger);
  });
});
