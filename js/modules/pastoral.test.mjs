// @vitest-environment jsdom
// #551 App 的管理分頁：用 index.html 裡真正的管理分頁畫面，假的 RPC／db，驗四個分頁、範圍、提醒加入。
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const indexHtml = readFileSync("index.html", "utf8");
const markup = indexHtml.slice(indexHtml.indexOf("<!-- admin-view:start -->"), indexHtml.indexOf("<!-- admin-view:end -->"));

const PLAN_ID = "00000000-0000-0000-c026-000000000001";
const BOOKS = [{ name: "創世記", chapters: 50 }, { name: "出埃及記", chapters: 40 }];
const DAYS = Array.from({ length: 30 }, () => ({ chapters: [{}, {}, {}] }));
// 計畫狀態看的是現在的時間：起訖放很寬，一定是「進行中」；進度比對看的是 RPC 回的 today
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

let rpc;
let db;

function setup({ role = "zone_leader", data = { today: TODAY, people: PEOPLE }, error = null } = {}) {
  document.body.innerHTML = markup;
  window.sessionStorage.clear();
  rpc = vi.fn(async () => ({ data, error }));
  db = {
    getFeatureSetting: vi.fn(async () => ({ enabled: true })),
    sendPlanJoinInvitation: vi.fn(async () => ({ success: true, context: { sent: true } }))
  };
  window.state = { currentUser: { role }, globalPlans: [PLAN], activePlans: [], activePlan: null, supabase: { rpc }, orgStructure: {} };
  window.db = db;
  window.getUserRoleCode = (user) => user.role;
  window.getCanonicalStageScheduleDays = () => DAYS;
  window.BIBLE_BOOKS = BOOKS;
  window.showToast = vi.fn();
}

async function load() {
  vi.resetModules();
  const mod = await import("./pastoral.js");
  mod.init();
  return mod;
}

const panel = (tab) => document.querySelector(`[data-pastoral-panel="${tab}"]`);
const tabButton = (tab) => document.querySelector(`[data-pastoral-tab="${tab}"]`);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => setup());

describe("管理分頁（#551）", () => {
  it("overview: funnel, 需要關心 and the unit comparison for a leader; names are escaped", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_pastoral_overview", { p_global_plan_id: PLAN_ID, p_preset_key: "2026-Q4" });
    const overview = panel("overview");
    expect(overview.classList.contains("hidden")).toBe(false);
    expect(overview.querySelectorAll(".pastoral-funnel__row")).toHaveLength(5);
    expect(overview.querySelector(".pastoral-funnel__value").textContent).toContain("4");
    expect(overview.textContent).toContain("需要關心（1 人）");
    expect(overview.querySelector(".pastoral-care__name").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
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

  it("clicking a unit narrows the scope", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    const unit = [...panel("overview").querySelectorAll(".pastoral-table__unit")].find((button) => button.textContent === "二牧區");
    unit.click();
    expect(document.querySelector('[data-pastoral-scope="pastoralZone"]').value).toBe("二牧區");
    expect(document.getElementById("pastoral-status").textContent).toContain("範圍內 2 人");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("roster: chips filter, 提醒加入 invites once, and the tab is announced for the URL", async () => {
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
    expect(roster.querySelectorAll(".pastoral-person")).toHaveLength(4);
    const chip = (id) => roster.querySelector(`[data-filter="${id}"]`);
    expect(chip("not_enrolled").textContent).toContain("未報名 1");
    chip("not_enrolled").click();
    expect(chip("not_enrolled").getAttribute("aria-pressed")).toBe("true");
    const cards = roster.querySelectorAll(".pastoral-person");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("李大華");
    const invite = cards[0].querySelector('[data-pastoral-action="invite"]');
    invite.click();
    await flush();
    expect(db.sendPlanJoinInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: PLAN_ID }), "u2");
    expect(invite.textContent).toBe("已提醒");
    expect(invite.disabled).toBe(true);
  });

  it("an old #/admin/join-status link opens the roster on 未報名", async () => {
    const mod = await load();
    expect(mod.openPastoralTab("join-status")).toBe(true);
    expect(mod.openPastoralTab("users")).toBe(false);
    await mod.renderPastoralView();
    expect(panel("roster").classList.contains("hidden")).toBe(false);
    expect(panel("roster").querySelector('[data-filter="not_enrolled"]').getAttribute("aria-pressed")).toBe("true");
  });

  it("teams: open teams and enrolled people without a team", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    tabButton("teams").click();
    const teams = panel("teams");
    expect(teams.textContent).toContain("還沒滿的隊（1）");
    expect(teams.querySelector(".pastoral-team__name").textContent).toBe("火箭隊");
    expect(teams.textContent).toContain("3 人隊・還缺 1 人");
    expect(teams.textContent).toContain("已報名、還沒組隊（2 人）");
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
    expect(rpc).not.toHaveBeenCalled();
    expect(panel("overview").textContent).toContain("您目前沒有管理權限。");
  });

  it("an RPC failure shows a retry hint instead of throwing", async () => {
    setup({ data: null, error: { message: "forbidden_rpc" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mod = await load();
    await mod.renderPastoralView();
    warn.mockRestore();
    expect(panel("overview").textContent).toContain("統計暫時載入不了");
  });

  it("uses the cache on return and refetches with 更新", async () => {
    const mod = await load();
    await mod.renderPastoralView();
    await mod.renderPastoralView();
    expect(rpc).toHaveBeenCalledTimes(1);
    document.getElementById("pastoral-refresh").click();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });
});
