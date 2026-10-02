import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// #370：計畫增刪改卡片拆成只有系統管理員會載入的 lazy chunk。
const read = path => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const app = read("js/app.js");
const plan = read("js/modules/plan.js");
const planAdmin = read("js/modules/plan-admin.js");

describe("plan-admin lazy chunk", () => {
  it("app.js 以字面值 import() 登記，且只在系統管理員時載入", () => {
    expect(app).toContain("'plan-admin': () => import('./modules/plan-admin.js'),");
    const start = app.indexOf("async function ensurePlanFeatureModulesLoaded() {");
    const body = app.slice(start, app.indexOf("\n}\n", start));
    expect(body).toMatch(/getUserRoleCode\(state\.currentUser\) === 'admin'\) \{[\s\S]*await loadModule\('plan-admin'\);[\s\S]*\}/);
  });

  it("管理員卡片的程式碼只在 plan-admin.js，plan.js 透過登記的 render 函式呼叫", () => {
    for (const name of ["function initAdminPlanManagement", "function wireRegionCohortPanel", "function renderAdminPlanManagement"]) {
      expect(plan).not.toContain(name);
      expect(planAdmin).toContain(name);
    }
    expect(plan).toContain("export function registerPlanAdminRenderer(render) {");
    expect(plan).toContain("if (isSystemAdmin && planAdminRenderer) {");
    expect(planAdmin).toContain("registerPlanAdminRenderer(renderAdminPlanManagement);");
  });

  it("plan-admin.js 的 init 會接好按鈕、登記 render，並補畫一次", () => {
    const start = planAdmin.indexOf("export function init() {");
    const body = planAdmin.slice(start, planAdmin.indexOf("\n}\n", start));
    expect(body).toContain("initAdminPlanManagement();");
    expect(body).toContain("registerPlanAdminRenderer(renderAdminPlanManagement);");
    expect(body).toContain("renderAdminPlanManagement();");
  });
});
