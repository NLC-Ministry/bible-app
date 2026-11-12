// @vitest-environment jsdom
// #551／#570／#584 App 的管理分頁：用 index.html 裡真正的管理分頁畫面，假的 nlc-data（plan_summary／plan_roster 用伺服器
// 同一份組裝 plan-report.mjs 算）與 db，驗四個分頁、範圍、名單篩選、提醒加入、關心提醒。
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlanRoster, buildPlanSummary, preparePlanReport } from "../../supabase/functions/_shared/progress/plan-report.mjs";

const indexHtml = readFileSync("index.html", "utf8");
const between = (name) => indexHtml.slice(indexHtml.indexOf(`<!-- ${name}:start -->`), indexHtml.indexOf(`<!-- ${name}:end -->`));
// 管理分頁在 .main-content 捲動區裡；全頁畫面（#584）一開始就在 body 底下
const markup = `<main class="main-content">${between("admin-view")}</main>${between("pastoral-layers")}`;

const PLAN_ID = "00000000-0000-0000-c026-000000000001";
const BOOKS = [{ name: "創世記", chapters: 50 }, { name: "出埃及記", chapters: 40 }];
const DAYS = Array.from({ length: 30 }, () => ({ chapters: [{}, {}, {}] }));
// 計畫狀態看的是現在的時間：起訖放很寬，一定是「進行中」；進度比對看的是伺服器回的 today
const PLAN = { id: PLAN_ID, name: "2026 第四季", startDate: "2000-01-01", endDate: "2999-12-31", books: ["創世記", "出埃及記"], days: DAYS, presetKey: "2026-Q4" };
const PLAN_B = { ...PLAN, id: "00000000-0000-0000-c027-000000000001", name: "2027 第一季", presetKey: "2027-Q1" };
const TODAY = "2000-01-12";

const row = (id, name, enrollment, extra = {}) => ({
  id,
  name,
  greatRegion: "東區",
  pastoralZone: "一牧區",
  smallGroup: "甲組",
  enrollment: enrollment && {
    planId: `plan-${id}`,
    round: 1,
    upgradeHandled: false,
    books: ["創世記", "出埃及記"],
    byRound: { 1: enrollment.chapters },
    maxRound: enrollment.chapters > 0 ? 1 : null,
    lastReadAt: "2000-01-12T01:00:00Z",
    readDays7: 2,
    ...enrollment
  },
  teams: [],
  quiz: { published: 0, submitted: 0 },
  ...extra
});

const PEOPLE = [
  row("u1", "<img src=x onerror=alert(1)>", { chapters: 9 }, { lightning: { answered: 3, correct: 2, weeks: ["2000-01-03", "2000-01-10"] } }),
  row("u2", "李大華", null, { pastoralZone: "二牧區", lightning: { answered: 1, correct: 1, weeks: ["2000-01-10"] } }),
  row("u3", "陳美玲", { chapters: 36 }, {
    pastoralZone: "二牧區",
    teams: [{ id: "t1", name: "火箭隊", division: 3, status: "forming", size: 2, captain: true }],
    quiz: { published: 4, submitted: 3 }
  }),
  row("u4", "林志強", { chapters: 90, byRound: { 1: 90 } }, { quiz: { published: 4, submitted: 0 } })
];

let planReport;
let db;

function serverReport(people) {
  const enrolled = people.filter((person) => person.enrollment).length;
  return preparePlanReport({
    resolved: { plan: PLAN, baselineDays: DAYS },
    overview: {
      today: TODAY,
      people,
      quiz: { days: 4 },
      lightning: { from: "2000-01-01", to: TODAY, weeks: [{ weekStart: "2000-01-03", questions: 3 }, { weekStart: "2000-01-10", questions: 2 }] },
      meta: { inScope: people.length, enrolled }
    },
    bibleBooks: BOOKS
  });
}

function setup({ role = "zone_leader", people = PEOPLE, error = null, plans = [PLAN] } = {}) {
  document.body.innerHTML = markup;
  window.sessionStorage.clear();
  planReport = vi.fn(async (action, args) => {
    if (error) return { data: null, error };
    const report = serverReport(people);
    return { data: action === "plan_summary" ? buildPlanSummary(report, args.scope) : buildPlanRoster(report), error: null };
  });
  db = {
    getFeatureSetting: vi.fn(async () => ({ enabled: true })),
    sendPlanJoinInvitation: vi.fn(async () => ({ success: true, context: { sent: true } }))
  };
  window.state = { currentUser: { role }, globalPlans: plans, activePlans: [], activePlan: null, supabase: { planReport }, orgStructure: {} };
  window.db = db;
  window.getUserRoleCode = (user) => user.role;
  window.getCanonicalStageScheduleDays = () => DAYS;
  window.BIBLE_BOOKS = BOOKS;
  window.showToast = vi.fn();
  window.openCareReminderDialog = vi.fn();
}

const calls = (action) => planReport.mock.calls.filter(([name]) => name === action);

async function load() {
  vi.resetModules();
  const mod = await import("./pastoral.js");
  mod.init();
  return mod;
}

const panel = (tab) => document.querySelector(`[data-pastoral-panel="${tab}"]`);
const tabButton = (tab) => document.querySelector(`[data-pastoral-tab="${tab}"]`);
const rowNames = (root) => [...root.querySelectorAll(".pastoral-row__name")].map((el) => el.firstChild.textContent);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const unitRow = (root, name) => [...root.querySelectorAll(".pastoral-unit")].find((el) => el.querySelector(".pastoral-unit__name").textContent === name);
const unitNames = (root) => [...root.querySelectorAll(".pastoral-unit__name")].map((el) => el.textContent);
const pickLabels = (sheet) => [...sheet.querySelectorAll(".pastoral-pick__label")].map((el) => el.firstChild.textContent);
const pick = (sheet, label) => [...sheet.querySelectorAll(".pastoral-pick")].find((el) => el.querySelector(".pastoral-pick__label").firstChild.textContent === label);
const appliedChips = (root) => [...root.querySelectorAll('[data-pastoral-action="clear-condition"]')].map((el) => el.textContent.trim());
const openRow = (root, id) => root.querySelector(`[data-pastoral-action="open-person"][data-person="${id}"]`).click();
// 麵包屑（#699、#701）
const crumbs = () => document.getElementById("pastoral-crumbs");
const crumbLabels = () => [...crumbs().querySelectorAll(".pastoral-crumbs__item")].map((el) => el.textContent.trim());
const crumb = (label) => [...crumbs().querySelectorAll(".pastoral-crumbs__item")].find((el) => el.textContent.trim() === label);
const nextCrumb = () => crumbs().querySelector('[data-pastoral-action="crumb-next"]');

beforeEach(() => setup());

describe("管理分頁（#551、#570、#584）", () => {
  it("overview: numbers only from plan_summary — funnel, 需要關心 counts and one row per unit", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    expect(planReport).toHaveBeenCalledTimes(1);
    expect(planReport).toHaveBeenCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: {} });
    const overview = panel("overview");
    expect(overview.classList.contains("hidden")).toBe(false);
    expect(overview.querySelectorAll(".pastoral-funnel__row")).toHaveLength(5);
    expect(overview.querySelector(".pastoral-funnel__value").textContent).toContain("4");
    expect(overview.textContent).toContain("需要關心（1 人）");
    expect(overview.textContent).toContain("落後 7 天以上 1 人");
    // 總覽不列任何人的名字
    expect(overview.textContent).not.toContain("onerror");
    expect(overview.textContent).not.toContain("李大華");
    // 範圍橫跨兩個牧區 → 比牧區；一個單位一列，不是表格（手機不用左右滑）
    expect(overview.textContent).toContain("各牧區比較");
    expect(overview.querySelector("table")).toBeNull();
    expect(unitNames(overview).sort()).toEqual(["一牧區", "二牧區"]);
    expect(unitRow(overview, "一牧區").textContent).toContain("需要關心 1 人");
    expect(unitRow(overview, "一牧區").querySelector(".pastoral-unit__note--alert")).not.toBeNull();
    expect(unitRow(overview, "二牧區").textContent).toContain("2 人");
    // 上方分段按鈕切指標：報名
    overview.querySelector('[data-pastoral-action="unit-metric"][data-metric="enrolled"]').click();
    expect(overview.querySelector('[data-metric="enrolled"]').getAttribute("aria-pressed")).toBe("true");
    expect(unitRow(overview, "二牧區").querySelector(".pastoral-unit__pct").textContent).toBe("50%");
    expect(unitRow(overview, "一牧區").querySelector(".pastoral-unit__pct").textContent).toBe("100%");
    expect(planReport).toHaveBeenCalledTimes(1);
    // 範圍列：一行計畫名稱＋更新時間；範圍寫在麵包屑（#701）；沒有下拉、沒有「更新」鈕
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季");
    expect(crumbLabels()).toEqual(["東區", "全部牧區"]);
    expect(document.getElementById("pastoral-refresh").textContent).toBe("剛剛更新");
    expect(document.querySelector("#pastoral-root select")).toBeNull();
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 4 人");
    expect(document.getElementById("pastoral-console-note").classList.contains("hidden")).toBe(true);
    expect(mod.getPastoralRouteTab()).toBeNull();
  });

  it("one plan: the scope bar shows just the plan and can't be tapped; levels are picked from the breadcrumb (#701)", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    const button = document.getElementById("pastoral-scope-button");
    const sheet = document.getElementById("pastoral-scope-sheet");
    expect(button.disabled).toBe(true);
    button.click();
    expect(sheet.classList.contains("hidden")).toBe(true);
    expect(mod.closePastoralLayer()).toBe(false);
    nextCrumb().click();
    expect(sheet.classList.contains("hidden")).toBe(false);
    expect(document.body.classList.contains("pastoral-layer-open")).toBe(true);
    expect(document.getElementById("pastoral-scope-sheet-title").textContent).toBe("選擇牧區");
    expect(pickLabels(sheet)).toEqual(["全部牧區", "一牧區", "二牧區"]);
    expect(sheet.querySelector('[aria-current="true"]').textContent).toContain("全部牧區");
    pick(sheet, "二牧區").click();
    await vi.waitFor(() => expect(sheet.classList.contains("hidden")).toBe(true));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: "二牧區" } });
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人");
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季");
    // 二牧區底下只有甲組：麵包屑照樣寫出來、不能點
    expect(crumbLabels()).toEqual(["東區", "全部牧區", "二牧區", "甲組"]);
    expect(document.body.classList.contains("pastoral-layer-open")).toBe(false);
    expect(calls("plan_roster")).toHaveLength(0);
  });

  it("two plans: the scope bar lists plans only and closes after picking; changing plan clears the back-key history", async () => {
    setup({ plans: [PLAN, PLAN_B] });
    const mod = await load();
    await mod.renderPastoralView();
    unitRow(panel("overview"), "二牧區").querySelector(".pastoral-unit__name").click();
    await vi.waitFor(() => expect(crumbLabels()).toEqual(["東區", "全部牧區", "二牧區", "甲組"]));
    expect(document.body.classList.contains("pastoral-scope-drilled")).toBe(true);
    const button = document.getElementById("pastoral-scope-button");
    expect(button.disabled).toBe(false);
    button.click();
    const sheet = document.getElementById("pastoral-scope-sheet");
    expect(document.getElementById("pastoral-scope-sheet-title").textContent).toBe("選擇計畫");
    expect(pickLabels(sheet)).toEqual(["2026 第四季", "2027 第一季"]);
    pick(sheet, "2027 第一季").click();
    await vi.waitFor(() => expect(sheet.classList.contains("hidden")).toBe(true));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_B.id, scope: {} });
    expect(mod.closePastoralLayer()).toBe(false);
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2027 第一季");
    expect(crumbLabels()).toEqual(["東區", "全部牧區"]);
    expect(document.body.classList.contains("pastoral-scope-drilled")).toBe(false);
    expect(mod.stepBackPastoralScope()).toBe(false);
  });

  it("clicking a unit name asks the server for that scope's numbers", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    unitRow(panel("overview"), "二牧區").querySelector(".pastoral-unit__name").click();
    await vi.waitFor(() => expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人"));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: "二牧區" } });
    expect(crumbLabels()).toEqual(["東區", "全部牧區", "二牧區", "甲組"]);
    expect(calls("plan_roster")).toHaveLength(0);
  });

  // #699：比較卡往下鑽之後要回得去——共用麵包屑（含選下一層）＋返回鍵一次退一層
  // #701：略過的層級補回麵包屑；點目前那段切換同層單位
  describe("麵包屑與往下鑽（#699、#701）", () => {
    const REGIONS = [
      ...PEOPLE,
      row("w1", "王西一", { chapters: 9 }, { greatRegion: "西區", pastoralZone: "三牧區", smallGroup: "丙組" }),
      row("w2", "王西二", { chapters: 9 }, { greatRegion: "西區", pastoralZone: "四牧區", smallGroup: "丁組" }),
      row("w3", "王西三", { chapters: 9 }, { greatRegion: "西區", pastoralZone: "三牧區", smallGroup: "戊組" }),
      // 北區只有一個牧區：點北區會直接比小組
      row("n1", "趙北一", { chapters: 9 }, { greatRegion: "北區", pastoralZone: "五牧區", smallGroup: "己組" }),
      row("n2", "趙北二", { chapters: 9 }, { greatRegion: "北區", pastoralZone: "五牧區", smallGroup: "庚組" })
    ];
    const status = () => document.getElementById("pastoral-status").textContent;
    const drilled = () => document.body.classList.contains("pastoral-scope-drilled");
    const title = () => document.getElementById("pastoral-scope-sheet-title").textContent;
    const sheet = () => document.getElementById("pastoral-scope-sheet");

    beforeEach(() => setup({ role: "admin", people: REGIONS }));

    it("comparison card: 大區 → 牧區, then the breadcrumb jumps back to 各大區比較", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      const overview = panel("overview");
      expect(overview.textContent).toContain("各大區比較");
      expect(crumbLabels()).toEqual(["全部大區"]);
      expect(nextCrumb().textContent.trim()).toBe("選大區");
      unitRow(overview, "西區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各牧區比較"));
      expect(crumbLabels()).toEqual(["全部大區", "西區"]);
      expect(nextCrumb().textContent.trim()).toBe("選牧區");
      unitRow(overview, "三牧區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各小組比較"));
      expect(crumbLabels()).toEqual(["全部大區", "西區", "三牧區"]);
      expect(crumbs().querySelector('[aria-current="page"]').textContent.trim()).toBe("三牧區");
      expect(nextCrumb().textContent.trim()).toBe("選小組");
      expect(drilled()).toBe(true);
      crumb("全部大區").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各大區比較"));
      expect(status()).toContain("範圍內 9 人");
      expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季");
      expect(crumbLabels()).toEqual(["全部大區"]);
      // 最上層的數字還在 5 分鐘快取內，不重問
      expect(calls("plan_summary")).toHaveLength(3);
      // 點麵包屑往上跳是直接跳，不留返回紀錄
      expect(drilled()).toBe(false);
      expect(mod.stepBackPastoralScope()).toBe(false);
    });

    it("the back key steps up one level at a time after drilling from the comparison card", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      const overview = panel("overview");
      unitRow(overview, "西區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各牧區比較"));
      unitRow(overview, "三牧區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各小組比較"));
      expect(mod.stepBackPastoralScope()).toBe(true);
      await vi.waitFor(() => expect(overview.textContent).toContain("各牧區比較"));
      expect(crumbLabels()).toEqual(["全部大區", "西區"]);
      expect(status()).toContain("範圍內 3 人");
      expect(drilled()).toBe(true);
      expect(mod.stepBackPastoralScope()).toBe(true);
      await vi.waitFor(() => expect(overview.textContent).toContain("各大區比較"));
      expect(drilled()).toBe(false);
      expect(mod.stepBackPastoralScope()).toBe(false);
    });

    it("roster: the breadcrumb's next level opens the picker at that level; picks are steps the back key undoes", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      tabButton("roster").click();
      const roster = panel("roster");
      await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(8));
      nextCrumb().click();
      expect(sheet().classList.contains("hidden")).toBe(false);
      expect(title()).toBe("選擇大區");
      pick(sheet(), "西區").click();
      await vi.waitFor(() => expect(title()).toBe("選擇牧區"));
      // 四牧區只有一個小組 → 沒有下一層可選，選完就關
      pick(sheet(), "四牧區").click();
      await vi.waitFor(() => expect(sheet().classList.contains("hidden")).toBe(true));
      expect(rowNames(roster)).toEqual(["王西二"]);
      expect(crumbLabels()).toEqual(["全部大區", "西區", "四牧區", "丁組"]);
      expect(nextCrumb()).toBeNull();
      expect(calls("plan_roster")).toHaveLength(1);
      expect(mod.stepBackPastoralScope()).toBe(true);
      await vi.waitFor(() => expect(crumbLabels()).toEqual(["全部大區", "西區"]));
      expect(rowNames(roster).sort()).toEqual(["王西一", "王西三", "王西二"].sort());
      crumb("全部大區").click();
      await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(8));
      expect(calls("plan_roster")).toHaveLength(1);
    });

    it("tapping the current segment switches to a sibling in place; the back key still goes up one level (#701)", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      tabButton("roster").click();
      const roster = panel("roster");
      await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(8));
      nextCrumb().click();
      pick(sheet(), "西區").click();
      await vi.waitFor(() => expect(title()).toBe("選擇牧區"));
      pick(sheet(), "四牧區").click();
      await vi.waitFor(() => expect(sheet().classList.contains("hidden")).toBe(true));
      // 目前那段是「四牧區 ▾」：列出西區的牧區，選三牧區就換過去、關掉，不再往下跳
      const current = crumbs().querySelector('[data-pastoral-action="crumb-switch"]');
      expect(current.textContent.trim()).toBe("四牧區");
      expect(current.getAttribute("aria-current")).toBe("page");
      current.click();
      expect(sheet().classList.contains("hidden")).toBe(false);
      expect(title()).toBe("選擇牧區");
      expect(pickLabels(sheet())).toEqual(["西區 全部牧區", "三牧區", "四牧區"]);
      pick(sheet(), "三牧區").click();
      await vi.waitFor(() => expect(sheet().classList.contains("hidden")).toBe(true));
      expect(crumbLabels()).toEqual(["全部大區", "西區", "三牧區"]);
      expect(rowNames(roster).sort()).toEqual(["王西一", "王西三"].sort());
      // 同層互換沒有多記一筆：返回鍵一次回到西區，再一次回到最上層
      expect(mod.stepBackPastoralScope()).toBe(true);
      await vi.waitFor(() => expect(crumbLabels()).toEqual(["全部大區", "西區"]));
      expect(mod.stepBackPastoralScope()).toBe(true);
      await vi.waitFor(() => expect(crumbLabels()).toEqual(["全部大區"]));
      expect(mod.stepBackPastoralScope()).toBe(false);
    });

    it("a skipped level stays in the breadcrumb: 北區 has one 牧區, so its 小組 still show 五牧區 (#701)", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      const overview = panel("overview");
      unitRow(overview, "北區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各小組比較"));
      expect(crumbLabels()).toEqual(["全部大區", "北區", "五牧區"]);
      expect(nextCrumb().textContent.trim()).toBe("選小組");
      unitRow(overview, "己組").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(status()).toContain("範圍內 1 人"));
      expect(crumbLabels()).toEqual(["全部大區", "北區", "五牧區", "己組"]);
      expect(crumbs().querySelector('[data-pastoral-action="crumb-switch"]').textContent.trim()).toBe("己組");
      crumb("五牧區").click();
      await vi.waitFor(() => expect(overview.textContent).toContain("各小組比較"));
      expect(crumbLabels()).toEqual(["全部大區", "北區", "五牧區"]);
    });

    it("leaving the tab clears the drill history", async () => {
      const mod = await load();
      await mod.renderPastoralView();
      unitRow(panel("overview"), "西區").querySelector(".pastoral-unit__name").click();
      await vi.waitFor(() => expect(drilled()).toBe(true));
      mod.closePastoralLayers();
      expect(drilled()).toBe(false);
      expect(mod.stepBackPastoralScope()).toBe(false);
    });

    it("someone with a single unit sees their place as a fixed breadcrumb (#701)", async () => {
      setup({ role: "group_leader", people: [PEOPLE[0]] });
      const mod = await load();
      await mod.renderPastoralView();
      expect(crumbs().classList.contains("hidden")).toBe(false);
      expect(crumbLabels()).toEqual(["東區", "一牧區", "甲組"]);
      expect(crumbs().querySelector("button")).toBeNull();
      expect(document.getElementById("pastoral-scope-button").disabled).toBe(true);
    });
  });

  it("roster: fetched once when opened; one row per person sorted by days behind; a row pushes the person page without a request", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    const announced = vi.fn();
    window.addEventListener("app:route-changed", announced);
    tabButton("roster").click();
    window.removeEventListener("app:route-changed", announced);
    expect(announced).toHaveBeenCalledTimes(1);
    expect(mod.getPastoralRouteTab()).toBe("roster");
    expect(panel("overview").classList.contains("hidden")).toBe(true);
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3));
    expect(planReport).toHaveBeenCalledWith("plan_roster", { p_global_plan_id: PLAN_ID });
    // 預設：報名者，落後天數多的在前；名字跳脫
    expect(rowNames(roster)[0]).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(roster.querySelector(".pastoral-row__chapters").textContent).toBe("9 章");
    // 點人 → 個人頁；返回回到名單原本的捲動位置與焦點
    const scrollerEl = document.querySelector(".main-content");
    scrollerEl.scrollTop = 120;
    const first = roster.querySelector(".pastoral-row__summary");
    first.focus();
    first.click();
    const sheet = document.getElementById("pastoral-person-sheet");
    expect(sheet.classList.contains("hidden")).toBe(false);
    expect(document.getElementById("pastoral-person-sheet-title").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    const body = sheet.querySelector("[data-pastoral-person-body]");
    expect(body.textContent).toContain("落後");
    expect(body.textContent).toContain("最後打卡");
    expect(body.querySelector('[data-pastoral-action="care"]')).not.toBeNull();
    scrollerEl.scrollTop = 0;
    expect(mod.closePastoralLayer()).toBe(true);
    expect(sheet.classList.contains("hidden")).toBe(true);
    expect(scrollerEl.scrollTop).toBe(120);
    expect(document.activeElement).toBe(first);
    expect(rowNames(roster)).toHaveLength(3);
    // 切分頁回來名單不再請求；App 沒有匯出
    tabButton("teams").click();
    tabButton("quizzes").click();
    tabButton("roster").click();
    expect(calls("plan_roster")).toHaveLength(1);
    expect(roster.textContent).not.toContain("匯出");
  });

  it("roster filters: full-page 篩選 (union inside, intersection across), removable condition chips and 顯示 N 人", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("roster").click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3));
    const filterButton = () => roster.querySelector('[data-pastoral-action="open-filters"]');
    expect(filterButton().textContent).toBe("篩選");
    expect(appliedChips(roster)).toEqual([]);
    filterButton().click();
    const sheet = document.getElementById("pastoral-filter-sheet");
    expect(sheet.classList.contains("hidden")).toBe(false);
    const chip = (key, id) => sheet.querySelector(`[data-pastoral-action="bucket"][data-key="${key}"][data-id="${id}"]`);
    const done = sheet.querySelector("[data-pastoral-filter-done]");
    expect(chip("progress", "not_enrolled").textContent).toContain("未報名 1");
    expect(chip("progress", "not_enrolled").getAttribute("aria-pressed")).toBe("false");
    expect(done.textContent).toBe("顯示 3 人");
    chip("progress", "not_enrolled").click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(4);
    expect(done.textContent).toBe("顯示 4 人");
    expect(chip("progress", "not_enrolled").getAttribute("aria-pressed")).toBe("true");
    sheet.querySelector('[data-pastoral-action="team"][data-team="yes"]').click();
    expect(rowNames(roster)).toEqual(["陳美玲"]);
    expect(done.textContent).toBe("顯示 1 人");
    done.click();
    expect(sheet.classList.contains("hidden")).toBe(true);
    expect(filterButton().textContent).toBe("篩選2");
    expect(appliedChips(roster)).toEqual(["含未報名", "有隊"]);
    // 點掉「有隊」：只拿掉那個條件
    roster.querySelector('[data-pastoral-action="clear-condition"][data-condition="team"]').click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(4);
    expect(appliedChips(roster)).toEqual(["含未報名"]);
    // 重設回到報名者
    filterButton().click();
    sheet.querySelector('[data-pastoral-action="reset-filters"]').click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3);
    expect(appliedChips(roster)).toEqual([]);
    mod.closePastoralLayer();
    const search = roster.querySelector("[data-pastoral-search]");
    search.value = "美";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1);
    expect(calls("plan_roster")).toHaveLength(1);
  });

  it("the fixed 需要關心 chip toggles the shortcut on and off", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("roster").click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3));
    const care = () => roster.querySelector('[data-pastoral-action="care-shortcut"]');
    expect(care().getAttribute("aria-pressed")).toBe("false");
    care().click();
    expect(care().getAttribute("aria-pressed")).toBe("true");
    expect(rowNames(roster)).toEqual(["<img src=x onerror=alert(1)>"]);
    care().click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3);
  });

  it("overview drill: 需要關心 opens the roster on that shortcut, shown as a chip", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    panel("overview").querySelector('[data-drill="careBehind"]').click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1));
    expect(rowNames(roster)).toEqual(["<img src=x onerror=alert(1)>"]);
    expect(appliedChips(roster)).toEqual(["需要關心・落後 7 天以上"]);
    roster.querySelector('[data-pastoral-action="open-filters"]').click();
    expect(document.getElementById("pastoral-filter-sheet").textContent).toContain("捷徑");
    expect(document.querySelector("[data-pastoral-filter-done]").textContent).toBe("顯示 1 人");
  });

  it("提醒加入 for people not enrolled; 關心提醒 opens the one-a-day dialog for the plan picked here", async () => {
    const mod = await load();
    expect(mod.openPastoralTab("join-status")).toBe(true);
    expect(mod.openPastoralTab("users")).toBe(false);
    await mod.renderPastoralView();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1));
    expect(appliedChips(roster)).toEqual(["未報名"]);
    expect(rowNames(roster)).toEqual(["李大華"]);
    openRow(roster, "u2");
    const person = document.getElementById("pastoral-person-sheet");
    const invite = person.querySelector('[data-pastoral-action="invite"]');
    invite.click();
    await flush();
    expect(db.sendPlanJoinInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID }), "u2");
    expect(invite.textContent).toBe("已提醒");
    expect(invite.disabled).toBe(true);
    mod.closePastoralLayer();

    roster.querySelector('[data-pastoral-action="clear-condition"][data-condition="progress"]').click();
    openRow(roster, "u1");
    person.querySelector('[data-pastoral-action="care"][data-person="u1"]').click();
    expect(window.openCareReminderDialog).toHaveBeenCalledWith(expect.objectContaining({
      id: "u1",
      isBehind: true,
      progressText: "累計 9 章",
      carePlanKey: "2026-Q4"
    }));
  });

  describe("全部提醒加入（#676）", () => {
    const openInviteAll = async () => {
      window.confirm = vi.fn(() => true);
      const mod = await load();
      mod.openPastoralTab("join-status");
      await mod.renderPastoralView();
      const roster = panel("roster");
      await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1));
      roster.querySelector('[data-pastoral-action="invite-all"]').click();
      return roster;
    };

    it("走批次 RPC；結果和按鈕文字照舊", async () => {
      db.sendPlanJoinInvitationsBatch = vi.fn(async () => ({
        success: true,
        results: [{ recipient_id: "u2", status: "sent" }]
      }));
      const roster = await openInviteAll();
      await vi.waitFor(() => expect(window.showToast).toHaveBeenCalled());
      expect(db.sendPlanJoinInvitationsBatch).toHaveBeenCalledTimes(1);
      expect(db.sendPlanJoinInvitationsBatch).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID }), ["u2"]);
      expect(db.sendPlanJoinInvitation).not.toHaveBeenCalled();
      expect(window.showToast.mock.calls.at(-1)[0]).toBe("已提醒 1 人");
      expect(roster.querySelector('[data-pastoral-action="invite-all"]').textContent).toBe("全部提醒加入");
    });

    it("今天已提醒的人照舊顯示", async () => {
      db.sendPlanJoinInvitationsBatch = vi.fn(async () => ({
        success: true,
        results: [{ recipient_id: "u2", status: "duplicate" }]
      }));
      await openInviteAll();
      await vi.waitFor(() => expect(window.showToast).toHaveBeenCalled());
      expect(window.showToast.mock.calls.at(-1)[0]).toBe("已提醒 0 人，1 人今天已提醒過");
    });

    it("批次 RPC 還沒上線：退回單筆，一樣送得出去", async () => {
      db.sendPlanJoinInvitationsBatch = vi.fn(async () => ({ success: false, error: { error: "forbidden_rpc" } }));
      await openInviteAll();
      await vi.waitFor(() => expect(window.showToast).toHaveBeenCalled());
      expect(db.sendPlanJoinInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID }), "u2");
      expect(window.showToast.mock.calls.at(-1)[0]).toBe("已提醒 1 人");
    });
  });

  it("leaving the 管理 tab closes any open page without touching the scroll position", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("roster").click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3));
    const scrollerEl = document.querySelector(".main-content");
    scrollerEl.scrollTop = 80;
    openRow(roster, "u1");
    scrollerEl.scrollTop = 0;
    mod.closePastoralLayers();
    expect(document.getElementById("pastoral-person-sheet").classList.contains("hidden")).toBe(true);
    expect(document.body.classList.contains("pastoral-layer-open")).toBe(false);
    expect(scrollerEl.scrollTop).toBe(0);
  });

  it("teams: open teams and enrolled people without a team", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("teams").click();
    const teams = panel("teams");
    await vi.waitFor(() => expect(teams.textContent).toContain("還沒滿的隊（1）"));
    expect(teams.querySelector(".pastoral-team__name").textContent).toBe("火箭隊");
    expect(teams.textContent).toContain("3 人隊・還缺 1 人");
    expect(teams.textContent).toContain("已報名、還沒組隊（2 人）");
    expect(teams.textContent).not.toContain("匯出");
  });

  it("quizzes: participation without ranking, one row per unit, plus the exam stats panel", async () => {
    const mod = await load();
    const renderExamStatsPanel = vi.fn(async (host) => { host.textContent = "大測驗統計"; });
    mod.registerExamStatsLoader(async () => ({ renderExamStatsPanel }));
    await mod.renderPastoralView();
    tabButton("quizzes").click();
    await vi.waitFor(() => expect(panel("quizzes").textContent).toContain("作答率"));
    const quizzes = panel("quizzes");
    // 順序：雲柱 → 小測驗 → 大測驗（#700）
    expect([...quizzes.querySelectorAll(".pastoral-card__title")].map((el) => el.textContent)).toEqual(["雲柱測驗", "小測驗", "大測驗"]);
    const daily = quizzes.querySelector("[data-pastoral-quiz]");
    expect(daily.textContent).toContain("38%");
    expect(daily.textContent).toContain("已發4 天");
    expect(daily.textContent).toContain("作答過1／3 人");
    expect(daily.textContent).not.toContain("有發題");
    expect(daily.textContent).toContain("從沒作答：林志強");
    // 有報名但沒收到題（沒有小組）：分開列，不算進作答率
    expect(daily.textContent).toContain("收不到題（不算進作答率）：<img src=x onerror=alert(1)>");
    expect(daily.querySelector("img")).toBeNull();
    expect(daily.textContent).toContain("不看分數、不排名");
    expect(quizzes.textContent).not.toMatch(/第 ?\d+ ?名|名次|平均分|分數：/);
    expect(quizzes.querySelector("table")).toBeNull();
    expect(unitNames(daily).sort()).toEqual(["一牧區", "二牧區"]);
    expect(unitRow(daily, "一牧區").textContent).toContain("報名 2 人");
    expect(unitRow(daily, "一牧區").textContent).toContain("從沒作答 1 人・收不到題 1 人");
    expect(unitRow(daily, "一牧區").querySelector(".pastoral-unit__pct").textContent).toBe("0%");
    expect(renderExamStatsPanel).toHaveBeenCalledWith(quizzes.querySelector("[data-pastoral-exam]"));
    expect(quizzes.textContent).toContain("大測驗統計");
  });

  it("lightning (#700): everyone in scope, weekly participation, overall and unit accuracy but never a person's", async () => {
    const mod = await load();
    mod.registerExamStatsLoader(async () => ({ renderExamStatsPanel: async () => {} }));
    await mod.renderPastoralView();
    tabButton("quizzes").click();
    await vi.waitFor(() => expect(panel("quizzes").textContent).toContain("期間參加過"));
    const card = panel("quizzes").querySelector("[data-pastoral-lightning-body]");
    expect(card.textContent).toContain("1/10 那週參加2 人（50%）");
    expect(card.textContent).toContain("期間參加過2／4 人");
    // 答對 3 ÷ 送出 4
    expect(card.textContent).toContain("答對率75%");
    expect(card.textContent).toContain("不限報名");
    expect(card.textContent).toContain("從沒參加：林志強、陳美玲");
    expect(unitRow(card, "1/3 那週").textContent).toContain("1 人參加");
    expect(unitRow(card, "一牧區").textContent).toContain("答對率 67%・從沒參加 1 人");
    expect(unitRow(card, "二牧區").textContent).toContain("答對率 100%・從沒參加 1 人");

    // 個人頁只有題數，沒有答對幾題
    expect(mod.openPastoralTab("join-status")).toBe(true);
    await mod.renderPastoralView();
    await vi.waitFor(() => expect(rowNames(panel("roster"))).toEqual(["李大華"]));
    openRow(panel("roster"), "u2");
    const sheet = document.getElementById("pastoral-person-sheet");
    await vi.waitFor(() => expect(sheet.textContent).toContain("計畫期間答 1／5 題"));
    expect(sheet.textContent).toContain("還沒報名這個計畫。");
    expect(sheet.textContent).not.toMatch(/答對/);
  });

  it("system administrator: whole church plus a link to the console", async () => {
    setup({ role: "admin" });
    const mod = await load();
    await mod.renderPastoralView();
    expect(document.getElementById("pastoral-console-note").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("pastoral-console-link").getAttribute("href")).toBe("https://bible-speed-reading-admin-staging.vercel.app/");
    expect(panel("overview").querySelectorAll(".pastoral-funnel__row")).toHaveLength(5);
  });

  it("members without a management role see a notice and nothing is fetched", async () => {
    setup({ role: "member" });
    const mod = await load();
    await mod.renderPastoralView();
    expect(planReport).not.toHaveBeenCalled();
    expect(panel("overview").textContent).toContain("您目前沒有管理權限。");
  });

  it("a failure shows a retry hint instead of throwing", async () => {
    setup({ error: { error: "forbidden" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await load();
    await mod.renderPastoralView();
    expect(panel("overview").textContent).toContain("統計暫時載入不了");
    tabButton("roster").click();
    await vi.waitFor(() => expect(panel("roster").textContent).toContain("名單暫時載入不了"));
    warn.mockRestore();
  });

  it("uses the cache on return and on coming back to the foreground; tapping the update time refetches", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    await mod.renderPastoralView();
    await mod.refreshPastoralOnForeground();
    expect(planReport).toHaveBeenCalledTimes(1);
    document.getElementById("pastoral-refresh").click();
    await vi.waitFor(() => expect(planReport).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(window.showToast).toHaveBeenCalledWith("資料已更新"));
  });
});
