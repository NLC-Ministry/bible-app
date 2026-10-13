// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { applyPlanSidebarVisibility } from "../js/modules/plan-sidebar-visibility.mjs";

// 計畫分頁右側欄只剩歡迎卡：只在「我的計畫」、使用者完全沒有計畫時出現，其他時候整欄隱藏。
// 「全域計畫管理」卡原本也在這一欄（2026-09-27 曾因整欄一起藏而找不到入口），#551 起搬到管理後台。
describe("plan sidebar: intro card only", () => {
  let sidebar, introCard;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="plan-sidebar-info-card">
        <div id="plan-sidebar-intro-card"></div>
      </div>`;
    sidebar = document.getElementById("plan-sidebar-info-card");
    introCard = document.getElementById("plan-sidebar-intro-card");
  });

  const run = (overrides) => applyPlanSidebarVisibility({
    sidebar, introCard, filter: "mine", hasAnyPlan: false, ...overrides
  });

  it("system admin on 探索計畫: no empty sidebar — the plan admin card lives in the console now (#551)", () => {
    run({ filter: "saved", hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
    run({ filter: "saved", hasAnyPlan: false, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
    expect(introCard.classList.contains("hidden")).toBe(true);
  });

  it("member with plans: whole sidebar hidden", () => {
    run({ hasAnyPlan: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("member with no plans on 我的計畫: sidebar and intro card visible", () => {
    sidebar.classList.add("hidden");
    introCard.classList.add("hidden");
    run({ hasAnyPlan: false });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(false);
  });

  it("member with no plans on 探索計畫: whole sidebar hidden — intro card only on 我的計畫 (#409)", () => {
    run({ filter: "saved", hasAnyPlan: false });
    expect(sidebar.classList.contains("hidden")).toBe(true);
    expect(introCard.classList.contains("hidden")).toBe(true);
  });

  it("已結束 tab hides the whole sidebar", () => {
    run({ filter: "completed", hasAnyPlan: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
    run({ filter: "completed", hasAnyPlan: false });
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("the App's index.html no longer has the plan admin card; the console's legacy page does (#551)", () => {
    expect(readFileSync("index.html", "utf8")).not.toContain('id="admin-plan-card"');
    expect(readFileSync("admin-legacy/admin-view.html", "utf8")).toContain('id="admin-plan-card"');
  });
});

// #409：邀請碼卡只在「我的計畫」。分頁條件由 CSS 讀 #plan-list-subview[data-active-filter]，
// 和它依組隊切換的 .hidden 分開。
describe("plan list: per-tab card placement (#409)", () => {
  const html = readFileSync("index.html", "utf8");
  const css = readFileSync("index.css", "utf8");
  const planJs = readFileSync("js/modules/plan.js", "utf8");

  it("plan list defaults to the 我的計畫 filter attribute", () => {
    expect(html).toContain('<div id="plan-list-subview" class="grid-layout" data-active-filter="mine">');
  });

  it("CSS hides the invite shortcut outside 我的計畫", () => {
    expect(css).toMatch(/#plan-list-subview:not\(\[data-active-filter="mine"\]\) #plan-team-invite-shortcut/);
    expect(css).not.toMatch(/data-active-filter="saved"\]\) #admin-plan-card/);
  });

  it("plan.js syncs the filter attribute from the active pill", () => {
    expect(planJs).toContain("listSubview.dataset.activeFilter = filter");
  });

  it("the invite card stays inside #plan-list-subview so the CSS selector applies", () => {
    const subviewIdx = html.indexOf('id="plan-list-subview"');
    const detailIdx = html.indexOf('id="plan-detail-subview"');
    const inviteIdx = html.indexOf('id="plan-team-invite-shortcut"');
    expect(inviteIdx).toBeGreaterThan(subviewIdx);
    if (detailIdx > -1) expect(inviteIdx).toBeLessThan(detailIdx);
  });
});
