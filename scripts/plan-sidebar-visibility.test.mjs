// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { applyPlanSidebarVisibility } from "../js/modules/plan-sidebar-visibility.mjs";

// 回歸：歡迎卡的隱藏邏輯曾經把整個側欄（含「全域計畫管理」）一起藏掉，
// 系統管理員只要有任何計畫就找不到新增計畫的入口（2026-09-27）。
describe("plan sidebar: intro card vs 全域計畫管理", () => {
  let sidebar, introCard;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="plan-sidebar-info-card">
        <div id="plan-sidebar-intro-card"></div>
        <div id="admin-plan-card" class="admin-only-plan-card"></div>
      </div>`;
    sidebar = document.getElementById("plan-sidebar-info-card");
    introCard = document.getElementById("plan-sidebar-intro-card");
  });

  const run = (overrides) => applyPlanSidebarVisibility({
    sidebar, introCard, filter: "mine", hasAnyPlan: false, isSystemAdmin: false, ...overrides
  });

  it("system admin on 探索計畫 with plans: sidebar stays visible (admin card reachable), intro card hidden", () => {
    run({ filter: "saved", hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(true);
  });

  it("system admin on 探索計畫 with no plans: sidebar visible, intro card still hidden (#409)", () => {
    run({ filter: "saved", hasAnyPlan: false, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(true);
  });

  it("system admin on 我的計畫 with plans: no empty sidebar — admin card lives on 探索計畫 (#409)", () => {
    run({ filter: "mine", hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("system admin on 我的計畫 with no plans: sidebar shows the intro card", () => {
    run({ filter: "mine", hasAnyPlan: false, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(false);
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

  it("已結束 tab hides the whole sidebar, even for a system admin", () => {
    run({ filter: "completed", hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
    run({ filter: "completed", hasAnyPlan: false, isSystemAdmin: false });
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("index.html keeps the admin card inside the same sidebar as the intro card", () => {
    const html = readFileSync("index.html", "utf8");
    const sidebarIdx = html.indexOf('id="plan-sidebar-info-card"');
    const introIdx = html.indexOf('id="plan-sidebar-intro-card"');
    const adminIdx = html.indexOf('id="admin-plan-card"');
    expect(sidebarIdx).toBeGreaterThan(-1);
    expect(introIdx).toBeGreaterThan(sidebarIdx);
    expect(adminIdx).toBeGreaterThan(introIdx);
  });
});

// #409：邀請碼卡只在「我的計畫」、全域計畫管理只在「探索計畫」。分頁條件由 CSS 讀
// #plan-list-subview[data-active-filter]，和各卡依組隊／角色切換的 .hidden 分開。
describe("plan list: per-tab card placement (#409)", () => {
  const html = readFileSync("index.html", "utf8");
  const css = readFileSync("index.css", "utf8");
  const planJs = readFileSync("js/modules/plan.js", "utf8");

  it("plan list defaults to the 我的計畫 filter attribute", () => {
    expect(html).toContain('<div id="plan-list-subview" class="grid-layout" data-active-filter="mine">');
  });

  it("CSS hides the invite shortcut outside 我的計畫 and the admin card outside 探索計畫", () => {
    expect(css).toMatch(/#plan-list-subview:not\(\[data-active-filter="mine"\]\) #plan-team-invite-shortcut/);
    expect(css).toMatch(/#plan-list-subview:not\(\[data-active-filter="saved"\]\) #admin-plan-card/);
  });

  it("plan.js syncs the filter attribute from the active pill", () => {
    expect(planJs).toContain("listSubview.dataset.activeFilter = filter");
  });

  it("both cards stay inside #plan-list-subview so the CSS selectors apply", () => {
    const subviewIdx = html.indexOf('id="plan-list-subview"');
    const detailIdx = html.indexOf('id="plan-detail-subview"');
    const inviteIdx = html.indexOf('id="plan-team-invite-shortcut"');
    const adminIdx = html.indexOf('id="admin-plan-card"');
    expect(inviteIdx).toBeGreaterThan(subviewIdx);
    expect(adminIdx).toBeGreaterThan(subviewIdx);
    if (detailIdx > -1) {
      expect(inviteIdx).toBeLessThan(detailIdx);
      expect(adminIdx).toBeLessThan(detailIdx);
    }
  });
});
