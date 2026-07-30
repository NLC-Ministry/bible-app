import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = readFileSync(join(root, "js", "db.js"), "utf8");
const utils = readFileSync(join(root, "js", "utils.js"), "utf8");

describe("active plan selection", () => {
  it("uses the nearest current or upcoming visible plan for dashboard-driving active state", () => {
    expect(utils).toContain("function selectMostRecentActivePlan(plans, currentDate = new Date())");
    expect(utils).toContain("window.selectMostRecentActivePlan = selectMostRecentActivePlan");
    expect(utils).toContain("const currentPlans = datedPlans.filter(plan => plan.startKey <= todayKey && plan.endKey >= todayKey);");
    expect(utils).toContain("const upcomingPlans = datedPlans.filter(plan => plan.startKey > todayKey);");
    expect(utils).toContain("return [...upcomingPlans].sort((a, b) => a.startKey.localeCompare(b.startKey))[0]?.plan || null;");
    expect(utils).not.toContain("const startCompare = String(b.startDate || b.start_date || \"\").localeCompare");

    const dataLoadFlow = db.slice(
      db.indexOf("// 3. Load Active Reading Plans"),
      db.indexOf("this.calculateStreak();")
    );
    expect(dataLoadFlow).toContain("state.activePlan = selectMostRecentActivePlan(state.activePlans);");
    expect(dataLoadFlow).not.toContain("localStorage.getItem(\"selected_plan_key\")");
    expect(dataLoadFlow).not.toContain("state.activePlan = state.activePlans[0]");

    const leaveFlow = db.slice(
      db.indexOf("async leavePlan"),
      db.indexOf("calculateAllPlansProgress();", db.indexOf("async leavePlan"))
    );
    expect(leaveFlow).toContain("state.activePlan = selectMostRecentActivePlan(state.activePlans);");
    expect(leaveFlow).not.toContain("state.activePlan = state.activePlans[0]");
  });
});
