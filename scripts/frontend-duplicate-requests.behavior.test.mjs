// @vitest-environment jsdom
// #672：實際跑 db.js／home.js／plan-stats.js，數真正送出去的請求。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// 每次重新載入模組都會在同一個 window 上掛監聽器；測完要拆掉，不然舊模組也會回應事件
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

describe("同一個人用同一個 nlc-data client（第 2 項）", () => {
  let db, subject, requests;

  const profile = id => ({ id, name: "測試會友" });
  const bodyOf = call => JSON.parse(call[1].body);
  const nlcDataCalls = () => requests.filter(call => String(call[0]).includes("/nlc-data")).map(bodyOf);

  beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    subject = "logto-sub-a";
    requests = [];
    vi.stubGlobal("CHURCH_PLAN_PRESETS", {});
    vi.stubGlobal("getPresetKeyByName", () => null);
    vi.stubGlobal("auth", {
      isLoggedIn: () => true,
      getValidAccessToken: async () => "access-token",
      getLogtoSubject: () => subject,
      keys: { idToken: "nlc_id_token" }
    });
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push([url, init]);
      const body = init && init.body ? JSON.parse(init.body) : {};
      if (String(url).includes("/nlc-session")) {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ edge_session: true, profile: nextSessionProfile, locked_fields: [] }) };
      }
      const rowFor = query => query.function === "get_reading_team_leaderboards"
        ? { division3: [{ id: "team", isMine: true }], division6: [] }
        : { from: query.table || query.function };
      const data = body.action === "batch" ? body.queries.map(query => ({ data: rowFor(query) })) : rowFor(body);
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data }) };
    }));
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      supabaseConfig: { url: "https://supabase.example.test", anonKey: "anon" },
      supabase: { auth: { getUser: async () => ({ data: { user: null } }) } },
      currentUser: {},
      currentProfileId: null,
      optimisticBootPending: false
    });
    await import("../js/db.js?frontend-duplicate-requests");
    db = window.db;
    db.applyNlcProfile = vi.fn(next => { globalThis.state.currentProfileId = next?.id || null; });
    db.storeOfflineIdentity = vi.fn();
    db.setOfflineNavLock = vi.fn();
    localStorage.setItem("nlc_edge_session_expires_at", String(Date.now() + 10 * 60 * 1000));
    localStorage.setItem("nlc_supabase_profile", JSON.stringify(profile("profile-a")));
  });

  let nextSessionProfile = profile("profile-a");
  beforeEach(() => { nextSessionProfile = profile("profile-a"); });

  it("getCurrentDbUser 不會換掉 client：前後發的讀取仍併成一支 batch", async () => {
    await db.getCurrentDbUser();
    const client = globalThis.state.supabase;
    const first = client.from("verse_likes").select("*").execute();
    await db.getCurrentDbUser();
    expect(globalThis.state.supabase).toBe(client);
    const second = globalThis.state.supabase.from("app_feature_settings").select("*").execute();
    await Promise.all([first, second]);
    expect(nlcDataCalls()).toHaveLength(1);
    expect(nlcDataCalls()[0].action).toBe("batch");
  });

  it("getCurrentDbUser 前後的相同讀取共用 3 秒內的結果", async () => {
    await db.getCurrentDbUser();
    await globalThis.state.supabase.from("verse_likes").select("*");
    await db.getCurrentDbUser();
    await globalThis.state.supabase.from("verse_likes").select("*");
    expect(nlcDataCalls()).toHaveLength(1);
  });

  it("換了登入身分（另一個分頁登入別人）：換 client，上一個人的共用結果不會被拿到", async () => {
    await db.getCurrentDbUser();
    const clientA = globalThis.state.supabase;
    await clientA.from("verse_likes").select("*");

    subject = "logto-sub-b";
    localStorage.setItem("nlc_supabase_profile", JSON.stringify(profile("profile-b")));
    await db.getCurrentDbUser();
    const clientB = globalThis.state.supabase;

    expect(clientB).not.toBe(clientA);
    await clientB.from("verse_likes").select("*");
    expect(nlcDataCalls()).toHaveLength(2);
  });

  it("nlc-session 回來的是另一個 profile：同樣換 client", async () => {
    await db.getCurrentDbUser();
    const clientA = globalThis.state.supabase;
    nextSessionProfile = profile("profile-merged");
    await db.syncNlcSessionWithSupabase(true);
    expect(globalThis.state.supabase).not.toBe(clientA);
  });

  it("重新跟伺服器確認過身分（角色／牧區可能變了）：client 不換，但共用結果清掉", async () => {
    await db.getCurrentDbUser();
    const client = globalThis.state.supabase;
    await client.from("verse_likes").select("*");
    await db.syncNlcSessionWithSupabase(true);
    expect(globalThis.state.supabase).toBe(client);
    await client.from("verse_likes").select("*");
    expect(nlcDataCalls()).toHaveLength(2);
  });

  it("目前的 client 被換成別的（重設登入時換回 Supabase client）：不沿用舊的", async () => {
    await db.getCurrentDbUser();
    const nlcClient = globalThis.state.supabase;
    globalThis.state.supabase = { auth: {} };
    await db.getCurrentDbUser();
    expect(globalThis.state.supabase).not.toBe(nlcClient);
    expect(typeof globalThis.state.supabase.from).toBe("function");
  });

  it("認不出登入身分時照舊每次建新的（不冒險共用）", async () => {
    subject = null;
    await db.getCurrentDbUser();
    const first = globalThis.state.supabase;
    await db.getCurrentDbUser();
    expect(globalThis.state.supabase).not.toBe(first);
  });

  it("排行分頁三支 RPC 同時發出時併成同一個 batch（第 3 項）", async () => {
    await db.getCurrentDbUser();
    const plan = { globalPlanId: "11111111-1111-4111-8111-111111111111" };
    await Promise.all([
      db.getReadingTeamLeaderboards(plan),
      db.getPersonalPlanRankingSummary(plan),
      db.getPastoralZoneLeaderboard(plan)
    ]);
    const calls = nlcDataCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].action).toBe("batch");
    expect(calls[0].queries.map(query => query.function).sort()).toEqual([
      "get_pastoral_zone_leaderboard",
      "get_personal_plan_ranking_summary",
      "get_reading_team_leaderboards"
    ]);
  });

  it("多個計畫同時查自己的隊伍併成一個 batch（第 5 項）", async () => {
    await db.getCurrentDbUser();
    const planIds = ["a", "b", "c"].map(digit => `${digit.repeat(8)}-1111-4111-8111-111111111111`);
    await Promise.all(planIds.map(globalPlanId => db.getMyReadingTeam({ globalPlanId })));
    const calls = nlcDataCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].queries.map(query => query.args.p_global_plan_id)).toEqual(planIds);
  });

  it("nlc-data 還沒部署新白名單時，排行照樣拿到資料（逐支補送）", async () => {
    await db.getCurrentDbUser();
    globalThis.fetch.mockImplementation(async (url, init) => {
      requests.push([url, init]);
      const body = JSON.parse(init.body);
      const data = body.action === "batch"
        ? body.queries.map(() => ({ error: "batch_read_only" }))
        : { zones: [{ name: body.function }], division3: [{ id: "team", isMine: true }] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data }) };
    });
    const plan = { globalPlanId: "11111111-1111-4111-8111-111111111111" };
    const [teams, personal, zones] = await Promise.all([
      db.getReadingTeamLeaderboards(plan),
      db.getPersonalPlanRankingSummary(plan),
      db.getPastoralZoneLeaderboard(plan)
    ]);
    expect(teams.success && personal.success && zones.success).toBe(true);
    expect(zones.context.zones[0].name).toBe("get_pastoral_zone_leaderboard");
    expect(nlcDataCalls().filter(call => call.action === "batch")).toHaveLength(1);
    expect(nlcDataCalls().filter(call => call.action === "rpc")).toHaveLength(3);
  });
});

describe("首頁只有在畫面上才重整（第 1 項）", () => {
  let dbCalls;

  async function loadHome(currentTab) {
    vi.resetModules();
    dbCalls = [];
    vi.stubGlobal("escapeHTML", value => String(value ?? ""));
    vi.stubGlobal("hydrateIcons", () => {});
    vi.stubGlobal("showToast", vi.fn());
    vi.stubGlobal("calculatePlanProgress", vi.fn());
    vi.stubGlobal("appRouter", { currentTab, switchTab: vi.fn() });
    vi.stubGlobal("state", {
      currentUser: { id: "me", name: "我" },
      currentProfileId: "me",
      activePlan: null,
      activePlans: [],
      isSupabaseMode: true,
      supabase: {}
    });
    // 每一支 db 讀取都記下來：首頁重整會打到的全部算在內
    vi.stubGlobal("db", new Proxy({}, {
      get: (_target, key) => (...args) => {
        dbCalls.push(String(key));
        return Promise.resolve({ success: false, enabled: false, args });
      }
    }));
    document.body.innerHTML = `<div id="active-plan-summary"></div><div id="user-greeting"></div>`;
    const home = await import("../js/modules/home.js?frontend-duplicate-requests");
    home.init();
    return home;
  }

  const checkIn = () => window.dispatchEvent(new CustomEvent("app:dataRefresh", { detail: { scope: "plan" } }));

  it("停在計畫分頁連續打卡 10 次：一支首頁讀取都不發，只更新本機進度", async () => {
    await loadHome("plan-view");
    for (let i = 0; i < 10; i++) checkIn();
    await wait(30);
    expect(dbCalls).toEqual([]);
    expect(globalThis.calculatePlanProgress).toHaveBeenCalled();
  });

  it("讀經頁直接呼叫 updateDashboardView 也一樣不發", async () => {
    await loadHome("reader-view");
    window.updateDashboardView();
    await wait(30);
    expect(dbCalls).toEqual([]);
  });

  it("切回首頁（switchTab 直接呼叫模組匯出的版本）才更新", async () => {
    const home = await loadHome("plan-view");
    checkIn();
    await wait(30);
    expect(dbCalls).toEqual([]);
    globalThis.appRouter.currentTab = "dashboard-view";
    home.updateDashboardView();
    // 次要讀取排在瀏覽器閒置時才做，機器忙的時候不只 30ms，所以等到發生為止。
    await vi.waitFor(() => expect(dbCalls.length).toBeGreaterThan(0), { timeout: 3000 });
  });

  it("在首頁時第一次立刻重整，500ms 內連續的只再補一次", async () => {
    await loadHome("dashboard-view");
    const greeting = document.getElementById("user-greeting");
    greeting.textContent = "";
    checkIn();
    expect(greeting.textContent).toBe("我");

    greeting.textContent = "";
    checkIn();
    checkIn();
    checkIn();
    expect(greeting.textContent).toBe("");
    await wait(520);
    expect(greeting.textContent).toBe("我");
  });

  it("排定的補一次如果到時已經離開首頁就不做", async () => {
    await loadHome("dashboard-view");
    const greeting = document.getElementById("user-greeting");
    checkIn();
    checkIn();
    globalThis.appRouter.currentTab = "plan-view";
    greeting.textContent = "";
    await wait(520);
    expect(greeting.textContent).toBe("");
  });
});

describe("排行分頁三區同時開始（第 3 項）", () => {
  it("牧區排行不等團隊排行和個人排名", async () => {
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    document.body.innerHTML = `
      <div id="reading-team-ranking-3"></div>
      <div id="my-rank-all"></div>
      <div class="glass-card"><div></div><div id="pastoral-ranking-list-container"></div></div>`;
    const teams = deferred();
    const personal = deferred();
    const zones = deferred();
    const dbStub = {
      getReadingTeamLeaderboards: vi.fn(() => teams.promise),
      getPersonalPlanRankingSummary: vi.fn(() => personal.promise),
      getPastoralZoneLeaderboard: vi.fn(() => zones.promise)
    };
    vi.stubGlobal("db", dbStub);
    vi.stubGlobal("state", { activePlan: { id: "plan-1" }, currentUser: { pastoral_zone: "" } });
    vi.stubGlobal("firstPaint", () => false);
    vi.stubGlobal("escapeHTML", value => String(value ?? ""));
    vi.stubGlobal("hydrateIcons", () => {});
    vi.stubGlobal("hasWholeChurchPlanScope", () => false);
    vi.stubGlobal("ComponentSkeletonLoader", { getHtml: () => "" });
    const { renderPlanRankingView } = await import("../js/modules/plan-stats.js?frontend-duplicate-requests");

    const done = renderPlanRankingView();
    await flush();
    expect(dbStub.getReadingTeamLeaderboards).toHaveBeenCalledTimes(1);
    expect(dbStub.getPersonalPlanRankingSummary).toHaveBeenCalledTimes(1);
    expect(dbStub.getPastoralZoneLeaderboard).toHaveBeenCalledTimes(1);

    teams.resolve({ success: true, context: { division3: [], division6: [] } });
    personal.resolve({ success: true, context: {} });
    zones.resolve({ success: true, context: { zones: [] } });
    await done;
    expect(document.getElementById("pastoral-ranking-list-container").textContent).toContain("目前沒有排行資料");
  });
});

describe("牧區分享牆（第 4 項）", () => {
  let queries, gate;

  // 假的 client：記下每支查詢，依表回傳
  function fakeClient(rowsByTable) {
    return {
      from(table) {
        const query = { table, filters: [], select: null };
        const builder = {
          select(columns) { query.select = columns; return builder; },
          eq(column, value) { query.filters.push(["eq", column, value]); return builder; },
          in(column, value) { query.filters.push(["in", column, value]); return builder; },
          order() { return builder; },
          limit() { return builder; },
          range() { return builder; },
          then(resolve, reject) {
            queries.push(query);
            const answer = () => {
              const inId = query.filters.find(f => f[0] === "in" && f[1] === "id");
              const rows = rowsByTable[table] || [];
              return { data: inId ? rows.filter(row => inId[2].includes(row.id)) : rows, error: null };
            };
            return (gate[table] || Promise.resolve()).then(answer).then(resolve, reject);
          }
        };
        return builder;
      }
    };
  }

  const rows = {
    profiles: [
      { id: "author", name: "作者", small_group: "A" },
      { id: "commenter", name: "留言者", small_group: "B" },
      { id: "bystander", name: "路人", small_group: "C" }
    ],
    devotional_notes: [{ id: "n1", user_id: "author", content: "心得", created_at: "2026-11-05T00:00:00Z", note_date: "2026-11-05" }],
    devotional_likes: [{ note_id: "n1", user_id: "bystander" }],
    devotional_comments: [{ id: "c1", note_id: "n1", user_id: "commenter", content: "留言內容", created_at: "2026-11-05T01:00:00Z" }]
  };

  async function openWall({ pastoralZone }) {
    vi.resetModules();
    queries = [];
    vi.stubGlobal("escapeHTML", value => String(value ?? ""));
    vi.stubGlobal("hydrateIcons", () => {});
    vi.stubGlobal("appRouter", { currentTab: "dashboard-view" });
    vi.stubGlobal("state", {
      isSupabaseMode: true,
      currentUser: { id: "me", name: "我", pastoral_zone: pastoralZone },
      supabase: fakeClient(rows)
    });
    vi.stubGlobal("db", {
      getCurrentDbUser: async () => ({ id: "me" }),
      fetchAllRows: async build => {
        const { data, error } = await build();
        return { data, error };
      }
    });
    document.body.innerHTML = `<div id="pastoral-sharing-wall-card"></div><div id="home-verse-wall"></div>`;
    await import("../js/modules/home.js?frontend-duplicate-requests-wall");
  }

  beforeEach(() => { gate = {}; });

  it("沒有牧區：不抓全部 profiles，只補查心得作者與留言者", async () => {
    await openWall({ pastoralZone: "" });
    window.dispatchEvent(new CustomEvent("pastoral-sharing-wall-changed", { detail: { enabled: true } }));
    await wait(10);
    const profileQueries = queries.filter(q => q.table === "profiles");
    expect(profileQueries).toHaveLength(1);
    const ids = profileQueries[0].filters.find(f => f[0] === "in" && f[1] === "id")[2];
    expect([...ids].sort()).toEqual(["author", "commenter"]);

    const notes = queries.find(q => q.table === "devotional_notes");
    expect(notes.filters.some(f => f[1] === "user_id")).toBe(false);

    const wall = document.getElementById("home-verse-wall").textContent;
    expect(wall).toContain("作者");
    expect(wall).toContain("留言者");
  });

  it("有牧區：維持先查牧區名單、心得依名單篩選，顯示不變", async () => {
    await openWall({ pastoralZone: "測試牧區" });
    window.dispatchEvent(new CustomEvent("pastoral-sharing-wall-changed", { detail: { enabled: true } }));
    await wait(10);
    const profileQueries = queries.filter(q => q.table === "profiles");
    expect(profileQueries).toHaveLength(1);
    expect(profileQueries[0].filters).toEqual([["eq", "pastoral_zone", "測試牧區"]]);
    const notes = queries.find(q => q.table === "devotional_notes");
    expect(notes.filters.find(f => f[1] === "user_id")[2]).toEqual(["author", "commenter", "bystander"]);
    expect(document.getElementById("home-verse-wall").textContent).toContain("作者");
  });

  it("讚和留言同時發出，不互相等待", async () => {
    const likes = deferred();
    gate.devotional_likes = likes.promise;
    await openWall({ pastoralZone: "測試牧區" });
    window.dispatchEvent(new CustomEvent("pastoral-sharing-wall-changed", { detail: { enabled: true } }));
    await wait(10);
    expect(queries.some(q => q.table === "devotional_comments")).toBe(true);
    likes.resolve();
    await wait(10);
    expect(document.getElementById("home-verse-wall").textContent).toContain("作者");
  });
});
