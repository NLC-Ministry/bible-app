import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  formatRankLabel,
  normalizeRankingExcluded,
  pickDayWinners,
  summarizeMyWeek
} from "../js/modules/lightning-quiz-analytics.mjs";

// #429：雲柱測驗每週前三名公布到首頁（人工排除、可設公布天數、加個人結果、不公布個人名次）

const candidates = [
  { userId: "u1", name: "甲", pastoralZone: "中永和", elapsedMs: 5000 },
  { userId: "u2", name: "乙", pastoralZone: "文山", elapsedMs: 6000 },
  { userId: "u3", name: "丙", pastoralZone: "大安9", elapsedMs: 7000 },
  { userId: "u4", name: "丁", pastoralZone: "新莊2", elapsedMs: 8000 },
  { userId: "u5", name: "戊", pastoralZone: "中山1", elapsedMs: 9000 }
];

describe("pickDayWinners", () => {
  it("takes the three fastest when nobody is excluded", () => {
    expect(pickDayWinners(candidates, []).map(w => [w.userId, w.rank])).toEqual([["u1", 1], ["u2", 2], ["u3", 3]]);
  });

  it("excluded people drop out and the next ones move up", () => {
    expect(pickDayWinners(candidates, ["u1", "u3"]).map(w => [w.userId, w.rank])).toEqual([["u2", 1], ["u4", 2], ["u5", 3]]);
  });

  it("returns fewer than three when not enough people answered correctly", () => {
    expect(pickDayWinners(candidates.slice(0, 2), ["u2"]).map(w => w.userId)).toEqual(["u1"]);
    expect(pickDayWinners([], [])).toEqual([]);
  });
});

describe("normalizeRankingExcluded", () => {
  it("keeps only this week's dates and people who are candidates that day", () => {
    const days = [
      { riseDate: "2026-09-28", candidates },
      { riseDate: "2026-09-30", candidates: candidates.slice(0, 2) }
    ];
    const result = normalizeRankingExcluded(days, {
      "2026-09-28": ["u2", "nobody"],
      "2026-09-30": ["u3"],
      "2026-10-09": ["u1"]
    });
    expect(result).toEqual({ "2026-09-28": ["u2"], "2026-09-30": [] });
  });
});

describe("labels and my week summary", () => {
  it("formats ranks like the published table", () => {
    expect([1, 2, 3].map(formatRankLabel)).toEqual(["第一名", "第二名", "第三名"]);
  });

  it("counts correct answers over the days that had a question", () => {
    expect(summarizeMyWeek([
      { mine: { result: "correct" } },
      { mine: { result: "wrong" } },
      { mine: { result: "not_participated" } }
    ])).toEqual({ total: 3, correct: 1 });
  });
});

// ── 首頁卡片 ────────────────────────────────────────────────────────────────

let dom;

function setupGlobals(getLightningQuizWeekRanking) {
  dom = new JSDOM(
    '<!doctype html><body><div id="lightning-quiz-ranking-card" class="hidden"><div id="lightning-quiz-ranking-host"></div></div></body>',
    { url: "https://example.test" }
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("escapeHTML", value => String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("db", { getLightningQuizWeekRanking });
}

const published = {
  status: "published",
  weekStart: "2026-09-28",
  weekEnd: "2026-10-04",
  displayUntil: "2026-10-05",
  secondsUntilHide: 5,
  days: [
    {
      riseDate: "2026-09-28",
      winners: [
        { rank: 1, name: "陳巧芬", pastoralZone: "中永和", elapsedMs: 55500 },
        { rank: 2, name: "婷羽", pastoralZone: "中永和", elapsedMs: 61500 },
        { rank: 3, name: "張淳玉", pastoralZone: "中山1", elapsedMs: 62000 }
      ],
      mine: { result: "correct", elapsedMs: 70300 }
    },
    {
      riseDate: "2026-09-30",
      winners: [{ rank: 1, name: "<b>蔡雁羽</b>", pastoralZone: "文山", elapsedMs: 43600 }],
      mine: { result: "wrong", elapsedMs: 12000 }
    },
    { riseDate: "2026-10-02", winners: [], mine: { result: "not_participated", elapsedMs: null } }
  ]
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  dom?.window.close();
});

describe("首頁「雲柱測驗前三名」卡片", () => {
  it("shows each day's top three, my result per day and my weekly total, without my rank", async () => {
    setupGlobals(vi.fn(async () => ({ success: true, data: published })));
    const { refreshLightningQuizRankingCard } = await import("../js/modules/lightning-quiz-ranking.mjs");
    await refreshLightningQuizRankingCard();

    const card = document.getElementById("lightning-quiz-ranking-card");
    expect(card.classList.contains("hidden")).toBe(false);
    const days = [...card.querySelectorAll(".lq-ranking__day")];
    expect(days.map(day => day.querySelector(".lq-ranking__date").textContent)).toEqual(["9/28（一）", "9/30（三）", "10/2（五）"]);
    const firstDay = [...days[0].querySelectorAll(".lq-ranking__row")].map(row => [
      row.querySelector(".lq-ranking__rank").textContent,
      row.querySelector(".lq-ranking__name").textContent,
      row.querySelector(".lq-ranking__zone").textContent,
      row.querySelector(".lq-ranking__time").textContent
    ]);
    expect(firstDay).toEqual([
      ["第一名", "陳巧芬", "中永和", "55.5 秒"],
      ["第二名", "婷羽", "中永和", "61.5 秒"],
      ["第三名", "張淳玉", "中山1", "62.0 秒"]
    ]);
    // 名字照資料顯示，但要跳脫
    expect(days[1].querySelector(".lq-ranking__name").innerHTML).toBe("&lt;b&gt;蔡雁羽&lt;/b&gt;");
    expect(days[2].querySelector(".lq-ranking__empty").textContent).toBe("這天沒有人答對。");

    expect(days.map(day => day.querySelector(".lq-ranking__mine").textContent)).toEqual([
      "我的結果：答對・70.3 秒",
      "我的結果：答錯・12.0 秒",
      "我的結果：未作答"
    ]);
    expect(card.querySelector(".lq-ranking__footer").textContent).toContain("這週你答對 1／3 題");
    expect(card.textContent).not.toMatch(/你的名次|你是第|我的名次/);
  });

  it("the history link opens 我的測驗 on the lightning tab, reaching back to the published week", async () => {
    setupGlobals(vi.fn(async () => ({ success: true, data: published })));
    const { refreshLightningQuizRankingCard, PROFILE_EXAMS_HINT_KEY } = await import("../js/modules/lightning-quiz-ranking.mjs");
    await refreshLightningQuizRankingCard();

    const link = document.querySelector("[data-lq-ranking-history]");
    expect(link.getAttribute("href")).toBe("#/profile/exams");
    link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(JSON.parse(dom.window.sessionStorage.getItem(PROFILE_EXAMS_HINT_KEY))).toEqual({ tab: "lightning", from: "2026-09-28" });
  });

  it("hides itself once the display period ends (server-side seconds)", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ success: true, data: published })
      .mockResolvedValueOnce({ success: true, data: { status: "none" } });
    setupGlobals(rpc);
    const { refreshLightningQuizRankingCard } = await import("../js/modules/lightning-quiz-ranking.mjs");
    await refreshLightningQuizRankingCard();
    expect(document.getElementById("lightning-quiz-ranking-card").classList.contains("hidden")).toBe(false);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(document.getElementById("lightning-quiz-ranking-card").classList.contains("hidden")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["nothing published", { success: true, data: { status: "none" } }],
    ["the RPC fails", { success: false }]
  ])("stays hidden and schedules nothing when %s", async (_label, response) => {
    const rpc = vi.fn(async () => response);
    setupGlobals(rpc);
    const { refreshLightningQuizRankingCard } = await import("../js/modules/lightning-quiz-ranking.mjs");
    await refreshLightningQuizRankingCard();
    expect(document.getElementById("lightning-quiz-ranking-card").classList.contains("hidden")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── 後端與串接 ──────────────────────────────────────────────────────────────

describe("wiring", () => {
  const migration = readFileSync("supabase/migrations/20261004015336_lightning_quiz_week_ranking.sql", "utf8");
  const nlcData = readFileSync("supabase/functions/nlc-data/index.ts", "utf8");
  const db = readFileSync("js/db.js", "utf8");
  const home = readFileSync("js/modules/home.js", "utf8");
  const html = readFileSync("index.html", "utf8");
  const profile = readFileSync("js/modules/profile.js", "utf8");
  const memberFn = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.get_lightning_quiz_week_ranking"));

  it("every new function is revoked from PUBLIC/anon/authenticated before granting", () => {
    const grants = {
      "_lightning_quiz_week_candidates(date)": "service_role",
      "admin_get_lightning_quiz_week_ranking(date, uuid)": "authenticated, service_role",
      "admin_publish_lightning_quiz_week_ranking(date, jsonb, int, uuid)": "authenticated, service_role",
      "admin_revoke_lightning_quiz_week_ranking(date, uuid)": "authenticated, service_role",
      "get_lightning_quiz_week_ranking(uuid)": "authenticated, service_role"
    };
    for (const [sig, to] of Object.entries(grants)) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO ${to};`);
    }
    expect(migration).toContain("REVOKE ALL ON TABLE public.lightning_quiz_week_rankings FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("ALTER TABLE public.lightning_quiz_week_rankings ENABLE ROW LEVEL SECURITY;");
  });

  it("the three admin functions are admin-gated", () => {
    expect(migration.split("IF NOT public._lightning_quiz_actor_is_admin(actor_id) THEN").length - 1).toBe(3);
  });

  it("publishing is limited to 1–7 days and only after the whole week has ended", () => {
    expect(migration).toContain("CHECK (display_days BETWEEN 1 AND 7)");
    expect(migration).toContain("p_display_days < 1 OR p_display_days > 7");
    expect(migration).toContain("RAISE EXCEPTION 'lightning_quiz_ranking_week_not_ended'");
    expect(migration).toContain("until_date := today_tw + p_display_days - 1;");
  });

  it("candidates are only correct, submitted answers, fastest first", () => {
    expect(migration).toContain("AND a.completed_at IS NOT NULL\n        AND a.is_correct");
    expect(migration).toContain("ORDER BY a.elapsed_ms, a.completed_at, a.user_id");
  });

  it("the member function never returns user ids, the exclusion list, or the caller's own rank", () => {
    expect(memberFn).not.toContain("'userId'");
    expect(memberFn).not.toContain("excluded");
    expect(memberFn).not.toMatch(/'myRank'|'rank', \(SELECT/);
    expect(memberFn).toContain("WHERE revoked_at IS NULL AND display_until >= today_tw");
  });

  it("nlc-data, db.js, home and profile are wired up", () => {
    for (const fn of [
      "get_lightning_quiz_week_ranking",
      "admin_get_lightning_quiz_week_ranking",
      "admin_publish_lightning_quiz_week_ranking",
      "admin_revoke_lightning_quiz_week_ranking"
    ]) {
      expect(nlcData).toContain(`"${fn}"`);
      expect(db).toContain(`_callLightningQuizRpc("${fn}"`);
    }
    expect(home).toContain("void refreshLightningQuizRankingCard();");
    expect(html).toContain('id="lightning-quiz-ranking-card"');
    expect(html).toContain('id="lightning-quiz-ranking-host"');
    expect(profile).toContain("takeProfileExamsHint()");
  });
});
