import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("js/app.js", "utf8");
const home = readFileSync("js/modules/home.js", "utf8");

describe("startup performance contract", () => {
  it("keeps React issue-report UI out of the initial app bundle", () => {
    expect(app).not.toContain("import React from 'react'");
    expect(app).not.toContain("from 'react-dom/client'");
    expect(app).not.toContain("../components/issue-report/IssueReportFab.tsx");
    expect(app).toContain("loadIssueReportUi");
    expect(app).toContain("ISSUE_REPORT_UI_MODULE_PATH");
    expect(app).toContain("import(path)");
  });

  it("keeps registration helper modules lazy until their surfaces need them", () => {
    expect(app).not.toContain("import './modules/campaign-rule-editor.js");
    expect(app).not.toContain("import './modules/team-registration.js");
    expect(app).toContain("ensurePlanFeatureModulesLoaded");
    expect(app).toContain("ensureAdminFeatureModulesLoaded");
  });

  it("does not block first dashboard render on care reminder fetches", () => {
    const forcedReminder = app.lastIndexOf("refreshCareReminderBadge({ force: true })");
    const firstDashboard = app.indexOf("await appRouter.switchTab('dashboard-view')");

    expect(forcedReminder).toBeGreaterThan(-1);
    expect(firstDashboard).toBeGreaterThan(-1);
    expect(forcedReminder).toBeGreaterThan(firstDashboard);
  });

  it("defers secondary dashboard widgets after the core dashboard card renders", () => {
    expect(home).toContain("scheduleDashboardSecondaryWork");
    expect(home).not.toContain("calculateAndRenderPersonalRankings();\n  renderPastoralZoneRankingList();\n  loadTodayDevotional();");
  });
});
