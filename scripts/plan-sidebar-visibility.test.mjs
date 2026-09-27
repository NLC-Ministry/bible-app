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

  it("system admin with plans: sidebar stays visible (admin card reachable), intro card hidden", () => {
    run({ hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(true);
  });

  it("system admin on 探索計畫 with plans: sidebar stays visible", () => {
    run({ filter: "saved", hasAnyPlan: true, isSystemAdmin: true });
    expect(sidebar.classList.contains("hidden")).toBe(false);
  });

  it("member with plans: whole sidebar hidden (unchanged behavior)", () => {
    run({ hasAnyPlan: true });
    expect(sidebar.classList.contains("hidden")).toBe(true);
  });

  it("member with no plans: sidebar and intro card visible", () => {
    sidebar.classList.add("hidden");
    introCard.classList.add("hidden");
    run({ hasAnyPlan: false });
    expect(sidebar.classList.contains("hidden")).toBe(false);
    expect(introCard.classList.contains("hidden")).toBe(false);
  });

  it("已結束 tab hides the whole sidebar, even for a system admin", () => {
    run({ filter: "completed", hasAnyPlan: true, isSystemAdmin: true });
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
