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
  row("u1", "<img src=x onerror=alert(1)>", { chapters: 9 }),
  row("u2", "李大華", null, { pastoralZone: "二牧區" }),
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
    overview: { today: TODAY, people, meta: { inScope: people.length, enrolled } },
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
    // 範圍列：一行「計畫 · 範圍」＋更新時間；沒有下拉、沒有「更新」鈕
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季 · 全部牧區");
    expect(document.getElementById("pastoral-refresh").textContent).toBe("剛剛更新");
    expect(document.querySelector("#pastoral-root select")).toBeNull();
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 4 人");
    expect(document.getElementById("pastoral-console-note").classList.contains("hidden")).toBe(true);
    expect(mod.getPastoralRouteTab()).toBeNull();
  });

  it("scope bar: one plan and one region → the full-page picker starts at 牧區; picking one asks the server and closes", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    document.getElementById("pastoral-scope-button").click();
    const sheet = document.getElementById("pastoral-scope-sheet");
    expect(sheet.classList.contains("hidden")).toBe(false);
    expect(document.body.classList.contains("pastoral-layer-open")).toBe(true);
    expect(document.getElementById("pastoral-scope-sheet-title").textContent).toBe("選擇牧區");
    expect(pickLabels(sheet)).toEqual(["全部牧區", "一牧區", "二牧區"]);
    expect(sheet.querySelector('[aria-current="true"]').textContent).toContain("全部牧區");
    pick(sheet, "二牧區").click();
    await vi.waitFor(() => expect(sheet.classList.contains("hidden")).toBe(true));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: "二牧區" } });
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人");
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季 · 二牧區");
    expect(document.body.classList.contains("pastoral-layer-open")).toBe(false);
    expect(calls("plan_roster")).toHaveLength(0);
    // 選「全部牧區」回到整個範圍
    document.getElementById("pastoral-scope-button").click();
    pick(sheet, "全部牧區").click();
    await vi.waitFor(() => expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 4 人"));
    expect(sheet.classList.contains("hidden")).toBe(true);
    expect(mod.closePastoralLayer()).toBe(false);
  });

  it("scope bar with two plans: plan first, then 牧區; the back key steps back one list at a time", async () => {
    setup({ plans: [PLAN, PLAN_B] });
    const mod = await load();
    await mod.renderPastoralView();
    document.getElementById("pastoral-scope-button").click();
    const sheet = document.getElementById("pastoral-scope-sheet");
    const title = () => document.getElementById("pastoral-scope-sheet-title").textContent;
    expect(title()).toBe("選擇計畫");
    expect(pickLabels(sheet)).toEqual(["2026 第四季", "2027 第一季"]);
    pick(sheet, "2027 第一季").click();
    await vi.waitFor(() => expect(title()).toBe("選擇牧區"));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_B.id, scope: {} });
    expect(mod.closePastoralLayer()).toBe(true);
    expect(title()).toBe("選擇計畫");
    expect(sheet.querySelector('[aria-current="true"]').textContent).toContain("2027 第一季");
    expect(mod.closePastoralLayer()).toBe(true);
    expect(sheet.classList.contains("hidden")).toBe(true);
    expect(mod.closePastoralLayer()).toBe(false);
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2027 第一季 · 全部牧區");
  });

  it("clicking a unit name asks the server for that scope's numbers", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    unitRow(panel("overview"), "二牧區").querySelector(".pastoral-unit__name").click();
    await vi.waitFor(() => expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人"));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: "二牧區" } });
    expect(document.getElementById("pastoral-scope-label").textContent).toBe("2026 第四季 · 二牧區");
    expect(calls("plan_roster")).toHaveLength(0);
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
    expect(quizzes.textContent).toContain("38%");
    expect(quizzes.textContent).toContain("從沒作答：林志強");
    expect(quizzes.textContent).toContain("不看分數、不排名");
    expect(quizzes.textContent).not.toMatch(/第 ?\d+ ?名|名次|平均分|分數：/);
    expect(quizzes.querySelector("table")).toBeNull();
    expect(unitNames(quizzes).sort()).toEqual(["一牧區", "二牧區"]);
    expect(unitRow(quizzes, "一牧區").textContent).toContain("從沒作答 1 人");
    expect(unitRow(quizzes, "一牧區").querySelector(".pastoral-unit__pct").textContent).toBe("0%");
    expect(renderExamStatsPanel).toHaveBeenCalledWith(quizzes.querySelector("[data-pastoral-exam]"));
    expect(quizzes.textContent).toContain("大測驗統計");
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
