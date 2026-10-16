// @vitest-environment jsdom
// #551／#570 App 的管理分頁：用 index.html 裡真正的管理分頁畫面，假的 nlc-data（plan_summary／plan_roster 用伺服器
// 同一份組裝 plan-report.mjs 算）與 db，驗四個分頁、範圍、名單篩選、提醒加入、關心提醒。
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlanRoster, buildPlanSummary, preparePlanReport } from "../../supabase/functions/_shared/progress/plan-report.mjs";

const indexHtml = readFileSync("index.html", "utf8");
const markup = indexHtml.slice(indexHtml.indexOf("<!-- admin-view:start -->"), indexHtml.indexOf("<!-- admin-view:end -->"));

const PLAN_ID = "00000000-0000-0000-c026-000000000001";
const BOOKS = [{ name: "創世記", chapters: 50 }, { name: "出埃及記", chapters: 40 }];
const DAYS = Array.from({ length: 30 }, () => ({ chapters: [{}, {}, {}] }));
// 計畫狀態看的是現在的時間：起訖放很寬，一定是「進行中」；進度比對看的是伺服器回的 today
const PLAN = { id: PLAN_ID, name: "2026 第四季", startDate: "2000-01-01", endDate: "2999-12-31", books: ["創世記", "出埃及記"], days: DAYS, presetKey: "2026-Q4" };
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

function setup({ role = "zone_leader", people = PEOPLE, error = null } = {}) {
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
  window.state = { currentUser: { role }, globalPlans: [PLAN], activePlans: [], activePlan: null, supabase: { planReport }, orgStructure: {} };
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

beforeEach(() => setup());

describe("管理分頁（#551、#570）", () => {
  it("overview: numbers only from plan_summary — funnel, 需要關心 counts and the unit comparison", async () => {
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
    // 範圍橫跨兩個牧區 → 比牧區
    expect(overview.textContent).toContain("各牧區比較");
    expect([...overview.querySelectorAll(".pastoral-table__unit")].map((button) => button.textContent).sort()).toEqual(["一牧區", "二牧區"]);
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 4 人");
    expect(document.getElementById("pastoral-console-note").classList.contains("hidden")).toBe(true);
    expect(mod.getPastoralRouteTab()).toBeNull();
  });

  it("only one unit at a level: that scope picker is hidden", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    const field = (level) => document.querySelector(`[data-pastoral-scope="${level}"]`).closest(".pastoral__field");
    expect(field("greatRegion").classList.contains("hidden")).toBe(true);
    expect(field("pastoralZone").classList.contains("hidden")).toBe(false);
    expect(field("smallGroup").classList.contains("hidden")).toBe(true);
  });

  it("clicking a unit asks the server for that scope's numbers", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    const unit = [...panel("overview").querySelectorAll(".pastoral-table__unit")].find((button) => button.textContent === "二牧區");
    unit.click();
    await vi.waitFor(() => expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人"));
    expect(planReport).toHaveBeenLastCalledWith("plan_summary", { p_global_plan_id: PLAN_ID, scope: { pastoralZone: "二牧區" } });
    expect(document.querySelector('[data-pastoral-scope="pastoralZone"]').value).toBe("二牧區");
    expect(calls("plan_roster")).toHaveLength(0);
  });

  it("roster: fetched once when opened; one row per person sorted by days behind; rows expand without a request", async () => {
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
    const first = roster.querySelector(".pastoral-row__summary");
    const detail = roster.querySelector(".pastoral-row__detail");
    expect(detail.hidden).toBe(true);
    first.click();
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toContain("落後");
    // 切分頁回來名單不再請求；App 沒有匯出
    tabButton("teams").click();
    tabButton("quizzes").click();
    tabButton("roster").click();
    expect(calls("plan_roster")).toHaveLength(1);
    expect(roster.textContent).not.toContain("匯出");
  });

  it("roster filters: 進度 and 最後打卡 chips (union inside, intersection across), team, and the 篩選（N 個條件）header", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("roster").click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3));
    const chip = (key, id) => roster.querySelector(`[data-pastoral-action="bucket"][data-key="${key}"][data-id="${id}"]`);
    expect(chip("progress", "not_enrolled").textContent).toContain("未報名 1");
    expect(chip("progress", "not_enrolled").getAttribute("aria-pressed")).toBe("false");
    expect(roster.querySelector(".pastoral-filters__summary").textContent).toBe("篩選");
    chip("progress", "not_enrolled").click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(4);
    expect(roster.querySelector(".pastoral-filters__summary").textContent).toBe("篩選（1 個條件）");
    roster.querySelector('[data-pastoral-action="team"][data-team="yes"]').click();
    expect(rowNames(roster)).toEqual(["陳美玲"]);
    expect(roster.querySelector(".pastoral-filters__summary").textContent).toBe("篩選（2 個條件）");
    roster.querySelector('[data-pastoral-action="reset-filters"]').click();
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(3);
    const search = roster.querySelector("[data-pastoral-search]");
    search.value = "美";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1);
    expect(calls("plan_roster")).toHaveLength(1);
  });

  it("overview drill: 需要關心 opens the roster on that shortcut", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    panel("overview").querySelector('[data-drill="careBehind"]').click();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1));
    expect(rowNames(roster)).toEqual(["<img src=x onerror=alert(1)>"]);
    expect(roster.textContent).toContain("捷徑");
    expect(roster.querySelector(".pastoral-filters__summary").textContent).toBe("篩選（1 個條件）");
  });

  it("提醒加入 for people not enrolled; 關心提醒 opens the one-a-day dialog for the plan picked here", async () => {
    const mod = await load();
    expect(mod.openPastoralTab("join-status")).toBe(true);
    expect(mod.openPastoralTab("users")).toBe(false);
    await mod.renderPastoralView();
    const roster = panel("roster");
    await vi.waitFor(() => expect(roster.querySelectorAll(".pastoral-row")).toHaveLength(1));
    expect(roster.querySelector('[data-key="progress"][data-id="not_enrolled"]').getAttribute("aria-pressed")).toBe("true");
    expect(rowNames(roster)).toEqual(["李大華"]);
    const invite = roster.querySelector('[data-pastoral-action="invite"]');
    invite.click();
    await flush();
    expect(db.sendPlanJoinInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID }), "u2");
    expect(invite.textContent).toBe("已提醒");
    expect(invite.disabled).toBe(true);

    roster.querySelector('[data-pastoral-action="preset"][data-preset="enrolled"]').click();
    roster.querySelector('[data-pastoral-action="care"][data-person="u1"]').click();
    expect(window.openCareReminderDialog).toHaveBeenCalledWith(expect.objectContaining({
      id: "u1",
      isBehind: true,
      progressText: "累計 9 章",
      carePlanKey: "2026-Q4"
    }));
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

  it("quizzes: participation without ranking, plus the exam stats panel", async () => {
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

  it("uses the cache on return and refetches with 更新", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    await mod.renderPastoralView();
    expect(planReport).toHaveBeenCalledTimes(1);
    document.getElementById("pastoral-refresh").click();
    await vi.waitFor(() => expect(planReport).toHaveBeenCalledTimes(2));
  });
});
