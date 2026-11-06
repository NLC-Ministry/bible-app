// @vitest-environment jsdom
// #667：實際跑 db.js，數真正送出去的請求；畫面部分跑 plan-stats.js。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PLAN_ID = "22222222-2222-4222-8222-222222222222";
const ENDED_PLAN_ID = "33333333-3333-4333-8333-333333333333";
const openPlan = { id: "rp-1", globalPlanId: PLAN_ID, endDate: "2099-12-31", books: [] };
const otherPlan = { id: "rp-2", globalPlanId: OTHER_PLAN_ID, endDate: "2099-12-31" };
const endedPlan = { id: "rp-3", globalPlanId: ENDED_PLAN_ID, endDate: "2020-01-31" };

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let addedListeners = [];
const realAddEventListener = window.addEventListener.bind(window);

beforeEach(() => {
  addedListeners = [];
  window.addEventListener = (type, listener, options) => {
    addedListeners.push([type, listener, options]);
    realAddEventListener(type, listener, options);
  };
});

afterEach(() => {
  addedListeners.forEach(([type, listener, options]) => window.removeEventListener(type, listener, options));
  window.addEventListener = realAddEventListener;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("排行榜快取（實際跑 db.js）", () => {
  let db, requests, clock, rank, respond;
  const RANKING_RPCS = ["get_reading_team_leaderboards", "get_personal_plan_ranking_summary", "get_pastoral_zone_leaderboard"];

  const rankingCalls = () => requests.flatMap(body => (body.action === "batch" ? body.queries : [body]))
    .filter(query => RANKING_RPCS.includes(query.function));
  const callsFor = fn => rankingCalls().filter(query => query.function === fn);

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    requests = [];
    rank = 5;
    clock = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    respond = query => {
      if (query.function === "get_reading_team_leaderboards") {
        return { data: { division3: [{ id: "team", name: "隊名-機密", chaptersRead: rank, isMine: true }], division6: [] } };
      }
      if (query.function === "get_personal_plan_ranking_summary") return { data: { churchRank: rank, churchTotal: 10 } };
      if (query.function === "get_pastoral_zone_leaderboard") return { data: { zones: [{ name: "牧區", chaptersRead: rank }] } };
      return { data: {} };
    };
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("auth", {
      isLoggedIn: () => true,
      getValidAccessToken: async () => "access-token",
      getLogtoSubject: () => "logto-sub",
      keys: { idToken: "nlc_id_token" }
    });
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const payload = body.action === "batch"
        ? { data: body.queries.map(query => { const row = respond(query); return row.error ? row : { data: row.data }; }) }
        : respond(body);
      return { ok: !payload.error, status: payload.error ? 400 : 200, headers: new Headers(), json: async () => payload };
    }));
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabaseConfig: { url: "https://supabase.example.test", anonKey: "anon" },
      supabase: null,
      currentUser: { id: "user-a" },
      currentProfileId: "user-a",
      activePlan: openPlan,
      readingLogs: [],
      optimisticBootPending: true
    });
    await import("../js/db.js?leaderboard-memory-cache");
    db = window.db;
    globalThis.state.supabase = db.createNlcDataClient();
    db.calculateStreak = vi.fn();
    db.saveLocalUserStats = vi.fn();
  });

  const readAll = (plan = openPlan) => Promise.all([
    db.getReadingTeamLeaderboards(plan),
    db.getPersonalPlanRankingSummary(plan),
    db.getPastoralZoneLeaderboard(plan)
  ]);
  const advance = ms => { clock += ms; };

  it("60 秒內再讀直接回快取，不發請求", async () => {
    const [firstTeams, firstPersonal, firstZones] = await readAll();
    expect(rankingCalls()).toHaveLength(3);
    advance(59_000);
    const [teams, personal, zones] = await readAll();
    expect(rankingCalls()).toHaveLength(3);
    expect(teams).toEqual(firstTeams);
    expect(personal).toEqual(firstPersonal);
    expect(zones).toEqual(firstZones);
  });

  it("每個呼叫端拿到自己的一份，改了不影響快取", async () => {
    const first = await db.getPersonalPlanRankingSummary(openPlan);
    first.context.churchRank = 999;
    const second = await db.getPersonalPlanRankingSummary(openPlan);
    expect(second.context.churchRank).toBe(5);
  });

  it("進行中的相同讀取只發一次", async () => {
    await Promise.all([readAll(), readAll(), readAll()]);
    expect(rankingCalls()).toHaveLength(3);
  });

  it("超過 60 秒：先回舊資料，背景重抓，有變才通知畫面，之後讀到新資料", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    const changes = [];
    window.addEventListener("leaderboards:changed", event => changes.push(event.detail));
    advance(60_000);
    rank = 3;
    await wait(5);
    requests.length = 0;

    const stale = await db.getPersonalPlanRankingSummary(openPlan);
    expect(stale.context.churchRank).toBe(5);
    await wait(30);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(1);
    expect(changes).toEqual([{ kind: "personal", planId: PLAN_ID, reason: "refreshed" }]);

    const fresh = await db.getPersonalPlanRankingSummary(openPlan);
    expect(fresh.context.churchRank).toBe(3);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(1);
  });

  it("背景重抓資料沒變就不通知畫面，失敗也留著舊資料", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    const changes = [];
    window.addEventListener("leaderboards:changed", event => changes.push(event.detail));
    advance(60_000);
    await wait(5);
    await db.getPersonalPlanRankingSummary(openPlan);
    await wait(30);
    expect(changes).toEqual([]);

    advance(60_000);
    await wait(5);
    respond = () => ({ error: "boom" });
    const stale = await db.getPersonalPlanRankingSummary(openPlan);
    await wait(30);
    expect(stale.context.churchRank).toBe(5);
    expect(changes).toEqual([]);
    expect((await db.getPersonalPlanRankingSummary(openPlan)).context.churchRank).toBe(5);
  });

  it("失敗的結果不快取，下次重抓", async () => {
    respond = () => ({ error: "boom" });
    const failed = await db.getPersonalPlanRankingSummary(openPlan);
    expect(failed.success).toBe(false);
    respond = () => ({ data: { churchRank: 2 } });
    await wait(5);
    const retried = await db.getPersonalPlanRankingSummary(openPlan);
    expect(retried.context.churchRank).toBe(2);
  });

  it("打卡後立刻失效：下一次讀到新排名", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    const changes = [];
    window.addEventListener("leaderboards:changed", event => changes.push(event.detail));
    rank = 2;
    await db.logChapterRead("創世記", 1, true, 1, openPlan);
    expect(changes).toEqual([{ kind: null, planId: PLAN_ID, reason: "invalidated" }]);
    const next = await db.getPersonalPlanRankingSummary(openPlan);
    expect(next.context.churchRank).toBe(2);
  });

  it("取消打卡也失效；別的計畫不受影響", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    await db.getPersonalPlanRankingSummary(otherPlan);
    rank = 2;
    await db.logChapterRead("創世記", 1, false, 1, openPlan);
    expect((await db.getPersonalPlanRankingSummary(openPlan)).context.churchRank).toBe(2);
    expect((await db.getPersonalPlanRankingSummary(otherPlan)).context.churchRank).toBe(5);
  });

  it("打卡前發出、打卡後才回來的舊請求不會寫回快取", async () => {
    const held = deferred();
    const original = respond;
    globalThis.fetch.mockImplementationOnce(async (url, init) => {
      requests.push(JSON.parse(init.body));
      await held.promise;
      return { ok: true, status: 200, headers: new Headers(), json: async () => original({ function: "get_personal_plan_ranking_summary" }) };
    });
    const beforeWrite = db.getPersonalPlanRankingSummary(openPlan);
    await flush();
    db.invalidateLeaderboards(openPlan);
    held.resolve();
    expect((await beforeWrite).context.churchRank).toBe(5);

    rank = 1;
    await wait(5);
    globalThis.state.supabase.invalidateReads();
    expect((await db.getPersonalPlanRankingSummary(openPlan)).context.churchRank).toBe(1);
  });

  it("加入、退出團隊後失效", async () => {
    for (const write of [() => db.joinReadingTeam(openPlan, "abc"), () => db.leaveReadingTeam("team")]) {
      await db.getReadingTeamLeaderboards(openPlan);
      requests.length = 0;
      await write();
      await db.getReadingTeamLeaderboards(openPlan);
      expect(callsFor("get_reading_team_leaderboards")).toHaveLength(1);
      requests.length = 0;
      await wait(1);
    }
  });

  it("已結束的計畫這次開 App 都不過期，別的計畫打卡或團隊異動也不清", async () => {
    await readAll(endedPlan);
    expect(rankingCalls()).toHaveLength(3);
    advance(6 * 60 * 60 * 1000);
    await db.logChapterRead("創世記", 1, true, 1, openPlan);
    await db.leaveReadingTeam("team");
    await readAll(endedPlan);
    await wait(30);
    expect(rankingCalls()).toHaveLength(3);
  });

  it("換帳號不會命中上一個人的排名", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    globalThis.state.currentProfileId = "user-b";
    globalThis.state.supabase.invalidateReads();
    rank = 8;
    expect((await db.getPersonalPlanRankingSummary(openPlan)).context.churchRank).toBe(8);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(2);
  });

  it("還不知道使用者是誰就不快取", async () => {
    globalThis.state.currentProfileId = null;
    await db.getPersonalPlanRankingSummary(openPlan);
    globalThis.state.supabase.invalidateReads();
    await wait(1);
    await db.getPersonalPlanRankingSummary(openPlan);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(2);
  });

  it("回前景：超過新鮮期才背景重抓，有變通知畫面", async () => {
    await db.getPersonalPlanRankingSummary(openPlan);
    const changes = [];
    window.addEventListener("leaderboards:changed", event => changes.push(event.detail));
    db.revalidateLeaderboards(openPlan);
    await wait(30);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(1);

    advance(60_000);
    rank = 4;
    await wait(5);
    requests.length = 0;
    db.revalidateLeaderboards(openPlan);
    await wait(30);
    expect(callsFor("get_personal_plan_ranking_summary")).toHaveLength(1);
    expect(changes).toEqual([{ kind: "personal", planId: PLAN_ID, reason: "refreshed" }]);
  });

  it("排行資料不留在裝置上", async () => {
    await readAll();
    expect(JSON.stringify({ ...localStorage })).not.toContain("隊名-機密");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("隊名-機密");
  });

  it("連勾 10 章：排行請求只在之後第一次看的時候發一次（不是每章一波）", async () => {
    await readAll();
    requests.length = 0;
    for (let chapter = 1; chapter <= 10; chapter++) {
      await db.logChapterRead("創世記", chapter, true, 1, openPlan);
    }
    expect(rankingCalls()).toHaveLength(0);
    await readAll();
    expect(rankingCalls()).toHaveLength(3);
  });

  it("離線佇列送出後失效", async () => {
    const { PwaCoordinator } = await import("../js/pwa/PwaCoordinator.js");
    await db.getPersonalPlanRankingSummary(openPlan);
    rank = 2;
    const coordinator = Object.create(PwaCoordinator.prototype);
    await coordinator.syncReadingOperation({
      planId: "rp-1", book: "創世記", chapter: 1, round: 1, readAt: "2026-11-05T00:00:00Z", isChecked: false
    });
    expect((await db.getPersonalPlanRankingSummary(openPlan)).context.churchRank).toBe(2);
  });
});

describe("排行畫面原地重畫（實際跑 plan-stats.js）", () => {
  let dbStub, rafCalls;

  async function loadRankingView({ currentTab = "plan-view", subTab = "ranking" } = {}) {
    vi.resetModules();
    rafCalls = 0;
    document.body.innerHTML = `
      <button id="tab-plan-ranking" class="active"></button>
      <span data-team-ranking-summary="3"></span>
      <details data-team-ranking-details><div id="reading-team-ranking-3"></div></details>
      <div id="my-rank-all"></div><div id="my-rank-all-total"></div>
      <div class="glass-card"><div></div><div id="pastoral-ranking-list-container"></div></div>`;
    let rank = 5;
    dbStub = {
      setRank: value => { rank = value; },
      _readingTeamPlanId: plan => plan.globalPlanId,
      getReadingTeamLeaderboards: vi.fn(async () => ({
        success: true,
        context: { division3: [{ id: "t", name: `第${rank}隊`, chaptersRead: rank, memberCount: 3, isMine: true }], division6: [] }
      })),
      getPersonalPlanRankingSummary: vi.fn(async () => ({ success: true, context: { churchRank: rank, churchTotal: 10 } })),
      getPastoralZoneLeaderboard: vi.fn(async () => ({
        success: true,
        context: { zones: [{ name: `牧區${rank}`, chaptersRead: rank, memberCount: 2, isMine: true }] }
      }))
    };
    vi.stubGlobal("db", dbStub);
    vi.stubGlobal("appRouter", { currentTab });
    vi.stubGlobal("state", { activePlan: openPlan, currentUser: { pastoral_zone: "" }, planActiveSubTab: subTab });
    vi.stubGlobal("firstPaint", el => !el || (el.childElementCount === 0 && !String(el.textContent || "").trim()));
    vi.stubGlobal("escapeHTML", value => String(value ?? ""));
    vi.stubGlobal("hydrateIcons", () => {});
    vi.stubGlobal("hasWholeChurchPlanScope", () => false);
    vi.stubGlobal("ComponentSkeletonLoader", { getHtml: () => "<i>skeleton</i>" });
    vi.stubGlobal("requestAnimationFrame", fn => { rafCalls += 1; fn(); return 1; });
    const { renderPlanRankingView } = await import("../js/modules/plan-stats.js?leaderboard-memory-cache");
    await renderPlanRankingView();
  }

  const changed = detail => window.dispatchEvent(new CustomEvent("leaderboards:changed", { detail }));

  // jsdom 沒有版面：照瀏覽器的行為模擬「換掉內容，捲動位置就掉回 0」
  function simulateScrollBox(element) {
    const innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    let scrollTop = 0;
    Object.defineProperty(element, "scrollTop", { configurable: true, get: () => scrollTop, set: value => { scrollTop = value; } });
    Object.defineProperty(element, "innerHTML", {
      configurable: true,
      get() { return innerHTML.get.call(this); },
      set(value) { innerHTML.set.call(this, value); scrollTop = 0; }
    });
  }
  // 記下重畫期間畫面上曾經出現過的骨架
  function watchSkeletons() {
    const seen = [];
    const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeName === "I") seen.push(node);
    })));
    observer.observe(document.body, { childList: true, subtree: true });
    return {
      stop() {
        observer.takeRecords().forEach(record => record.addedNodes.forEach(node => {
          if (node.nodeName === "I") seen.push(node);
        }));
        observer.disconnect();
        return seen;
      }
    };
  }

  it("看著排行：只更新有變的那一區，換上新數字，沒有骨架和載入中文字", async () => {
    await loadRankingView();
    dbStub.setRank(2);
    dbStub.getReadingTeamLeaderboards.mockClear();
    dbStub.getPastoralZoneLeaderboard.mockClear();
    const skeletons = watchSkeletons();
    changed({ kind: "personal", planId: PLAN_ID, reason: "refreshed" });
    await flush();
    expect(skeletons.stop()).toEqual([]);
    expect(document.getElementById("my-rank-all").textContent).toBe("第 2 名");
    expect(dbStub.getReadingTeamLeaderboards).not.toHaveBeenCalled();
    expect(dbStub.getPastoralZoneLeaderboard).not.toHaveBeenCalled();
  });

  it("團隊和牧區列表：捲動位置不動、排名列直接到定位不重跑動畫", async () => {
    await loadRankingView();
    const team = document.getElementById("reading-team-ranking-3");
    const zones = document.getElementById("pastoral-ranking-list-container");
    simulateScrollBox(team);
    simulateScrollBox(zones);
    team.scrollTop = 120;
    zones.scrollTop = 80;
    dbStub.setRank(2);
    rafCalls = 0;
    const skeletons = watchSkeletons();
    const seenSummary = [];
    const summary = document.querySelector('[data-team-ranking-summary="3"]');
    const observer = new MutationObserver(() => seenSummary.push(summary.textContent));
    observer.observe(summary, { childList: true, characterData: true, subtree: true });

    changed({ kind: null, planId: PLAN_ID, reason: "invalidated" });
    await flush();
    observer.disconnect();
    expect(skeletons.stop()).toEqual([]);

    expect(team.textContent).toContain("第2隊");
    expect(zones.textContent).toContain("牧區2");
    expect(team.scrollTop).toBe(120);
    expect(zones.scrollTop).toBe(80);
    expect(rafCalls).toBe(0);
    expect(seenSummary.join("")).not.toContain("載入中");
    team.querySelectorAll(".bar-race-row").forEach(row => {
      expect(row.classList.contains("is-running")).toBe(true);
      expect(row.style.transition).toBe("none");
    });
    zones.querySelectorAll(".pastoral-race-row").forEach(row => {
      expect(row.classList.contains("is-running")).toBe(true);
    });
    expect(team.hasAttribute("aria-busy")).toBe(false);
  });

  it("更新失敗：畫面留著舊資料，不換成錯誤訊息", async () => {
    await loadRankingView();
    dbStub.getReadingTeamLeaderboards.mockResolvedValue({ success: false, message: "壞了" });
    dbStub.getPersonalPlanRankingSummary.mockResolvedValue({ success: false });
    dbStub.getPastoralZoneLeaderboard.mockRejectedValue(new Error("壞了"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    changed({ kind: null, planId: PLAN_ID, reason: "invalidated" });
    await wait(5);
    expect(document.getElementById("reading-team-ranking-3").textContent).toContain("第5隊");
    expect(document.getElementById("my-rank-all").textContent).toBe("第 5 名");
    expect(document.getElementById("pastoral-ranking-list-container").textContent).toContain("牧區5");
  });

  it.each([
    ["不在計畫分頁", { currentTab: "reader-view" }, PLAN_ID],
    ["切回讀經頁（排行按鈕還亮著）", { subTab: "today" }, PLAN_ID],
    ["是別的計畫的資料", {}, OTHER_PLAN_ID]
  ])("%s：不重畫也不發請求", async (_label, view, planId) => {
    await loadRankingView(view);
    dbStub.getPersonalPlanRankingSummary.mockClear();
    changed({ kind: "personal", planId, reason: "refreshed" });
    await flush();
    expect(dbStub.getPersonalPlanRankingSummary).not.toHaveBeenCalled();
  });
});
