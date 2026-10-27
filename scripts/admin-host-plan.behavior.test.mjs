// 後台外框給的計畫（#620）：照搬的小測驗、組隊狀況用外框的計畫選單（經 bridge 的 plan 訊息），
// iframe 不再顯示自己的「計畫篩選」；外框沒給、或給的計畫 iframe 的清單裡沒有，就照舊顯示計畫篩選。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let dom;
let admin;

const PLANS = [
  { id: "g1", globalPlanId: "g1", name: "秋季速讀", startDate: "2026-10-01", endDate: "2099-12-31", days: [{}] },
  { id: "g2", globalPlanId: "g2", name: "夏季速讀", startDate: "2026-06-01", endDate: "2026-08-31", days: [{}] }
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM(`<!doctype html><body>
    <div id="admin-section-content">
      <div id="admin-plan-context" class="admin-plan-context hidden">
        <section class="glass-card admin-plan-filter-card"><select id="admin-management-plan-select"></select></section>
        <section class="glass-card admin-plan-filter-card admin-plan-filter-card--org"><button id="admin-plan-refresh-btn">更新</button></section>
      </div>
      <div id="admin-section-quizzes" class="admin-section-panel hidden"></div>
      <div id="admin-section-teams" class="admin-section-panel hidden"></div>
    </div>
  </body>`, { url: "https://example.test" });
  dom.window.dailyQuizFeatureEnabled = true;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("Option", dom.window.Option);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("state", { currentUser: { role: "admin" }, activePlans: [], globalPlans: PLANS, activePlan: null });
  vi.stubGlobal("getUserRoleCode", () => "admin");
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  // 載入子分頁資料的 RPC 這裡不關心：一律回失敗，畫面顯示錯誤就好
  vi.stubGlobal("db", new Proxy({}, { get: () => async () => ({ success: false, message: "測試" }) }));
  admin = await import("../js/modules/admin.js?admin-host-plan");
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

const planCard = () => document.querySelector(".admin-plan-filter-card:not(.admin-plan-filter-card--org)");
const orgCard = () => document.querySelector(".admin-plan-filter-card--org");
const shown = element => !element.classList.contains("hidden") && element.style.display !== "none";
const open = async id => {
  expect(admin.openAdminSectionRoute(id)).toBe(true);
  await flush();
};

describe("plan from the admin console (#620)", () => {
  it("opens the section on the console's plan and hides the iframe's own 計畫篩選", async () => {
    admin.setHostManagementPlan("g2");
    await open("quizzes");
    expect(state.adminManagementPlan.globalPlanId).toBe("g2");
    expect(document.getElementById("admin-management-plan-select").value).toBe("g2");
    expect(shown(planCard())).toBe(false);
  });

  it("follows the console when it changes the plan while a section is open", async () => {
    admin.setHostManagementPlan("g2");
    await open("quizzes");
    admin.setHostManagementPlan("g1");
    await flush();
    expect(state.adminManagementPlan.globalPlanId).toBe("g1");
    expect(document.getElementById("admin-management-plan-select").value).toBe("g1");
  });

  it("組隊狀況 keeps the org filter and its 更新 button; only the plan filter goes", async () => {
    admin.setHostManagementPlan("g2");
    await open("teams");
    expect(state.adminManagementPlan.globalPlanId).toBe("g2");
    expect(shown(planCard())).toBe(false);
    expect(shown(orgCard())).toBe(true);
  });

  it("no plan from the console, or one the iframe does not list: its own 計畫篩選 stays", async () => {
    await open("quizzes");
    expect(shown(planCard())).toBe(true);
    expect(state.adminManagementPlan.globalPlanId).toBe("g1"); // 進行中的計畫

    admin.setHostManagementPlan("not-listed");
    await flush();
    expect(shown(planCard())).toBe(true);
    expect(state.adminManagementPlan.globalPlanId).toBe("g1");

    admin.setHostManagementPlan("g2");
    await flush();
    expect(shown(planCard())).toBe(false);
    admin.setHostManagementPlan(null);
    await flush();
    expect(shown(planCard())).toBe(true);
    expect(state.adminManagementPlan.globalPlanId).toBe("g2"); // 外框不給了：停在原本的計畫，讓人自己換
  });
});
