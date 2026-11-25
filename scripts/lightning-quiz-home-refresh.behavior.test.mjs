import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

// #402：沒有小測驗時（hidden／no_question），首頁卡片只查一次，不能排下一次更新；
// 有時段結束秒數時，時段結束後剛好再查一次。

let dom;

function setupGlobals(getTodaysLightningQuiz) {
  dom = new JSDOM(
    '<!doctype html><body><section id="lightning-quiz-card" class="hidden"><div id="lightning-quiz-host"></div></section></body>',
    { url: "https://example.test" }
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("state", { currentUser: { id: "u1" } });
  vi.stubGlobal("escapeHTML", value => String(value));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  vi.stubGlobal("db", { getTodaysLightningQuiz });
}

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

describe("首頁雲柱測驗卡片的自動更新", () => {
  it.each(["hidden", "no_question"])("狀態是 %s 時只查一次，不排計時器", async status => {
    const rpc = vi.fn(async () => ({ success: true, data: { status } }));
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    expect(document.getElementById("lightning-quiz-card").classList.contains("hidden")).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("RPC 失敗時也不排計時器", async () => {
    const rpc = vi.fn(async () => ({ success: false }));
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("answered 且 secondsUntilEnd = 5 時，6 秒後剛好再查一次，之後收起不再查", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { status: "answered", isCorrect: true, elapsedMs: 3200, secondsUntilEnd: 5 } })
      .mockResolvedValue({ success: true, data: { status: "hidden" } });
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    expect(document.getElementById("lightning-quiz-card").classList.contains("hidden")).toBe(false);

    await vi.advanceTimersByTimeAsync(5_999);
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(document.getElementById("lightning-quiz-card").classList.contains("hidden")).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("同一天好幾題（items）時全部並列：還沒答的有開始鈕、答過的顯示結果，時段最早結束時再查", async () => {
    const payload = { stem: "題目", options: ["甲", "乙"] };
    const rpc = vi.fn(async () => ({
      success: true,
      data: {
        status: "available", questionId: "q2", questionType: "single", payload, secondsUntilEnd: 100,
        items: [
          { status: "answered", questionId: "q1", isCorrect: true, elapsedMs: 3200, secondsUntilEnd: 100 },
          { status: "available", questionId: "q2", questionType: "single", payload, secondsUntilEnd: 50 }
        ]
      }
    }));
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    const host = document.getElementById("lightning-quiz-host");
    const items = host.querySelectorAll(".lightning-quiz-multi__item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("第 1 題");
    expect(items[0].querySelector(".lightning-quiz-result.is-correct")).not.toBeNull();
    expect(items[1].textContent).toContain("第 2 題");
    expect(items[1].querySelector("[data-lq-start]")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(50_999);
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  // #718：還沒開始的題目顯示開放時段，已結束的顯示自己的結果；最早要變化的那一刻（開始或結束）再查
  it("還沒開始、已結束的題目也列出來，並在下一題開始時再查", async () => {
    const payload = { stem: "題目", options: ["甲", "乙"] };
    const rpc = vi.fn(async () => ({
      success: true,
      data: {
        status: "available", questionId: "q2", questionType: "single", payload, secondsUntilEnd: 100,
        items: [
          { status: "ended", questionId: "q1", result: "correct", elapsedMs: 4200, riseTimeStart: "07:00", riseTimeEnd: "08:00" },
          { status: "available", questionId: "q2", questionType: "single", payload, secondsUntilEnd: 100, riseTimeStart: "11:00", riseTimeEnd: "14:00" },
          { status: "upcoming", questionId: "q3", secondsUntilStart: 30, riseTimeStart: "19:00", riseTimeEnd: "22:00" },
          { status: "ended", questionId: "q4", result: "not_participated", elapsedMs: null, riseTimeStart: "09:00", riseTimeEnd: "10:00" }
        ]
      }
    }));
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    const host = document.getElementById("lightning-quiz-host");
    const items = [...host.querySelectorAll(".lightning-quiz-multi__item")];
    expect(items).toHaveLength(4);
    expect(host.querySelector(".lightning-quiz-multi__note").textContent).toContain("今天有 4 題");
    expect(items[0].querySelector(".lightning-quiz-multi__label").textContent).toBe("第 1 題・07:00–08:00");
    expect(items[0].textContent).toContain("已結束");
    expect(items[0].textContent).toContain("答對了・4.2 秒");
    expect(items[1].querySelector("[data-lq-start]")).not.toBeNull();
    expect(items[2].textContent).toContain("19:00 開放作答");
    expect(items[2].querySelector("[data-lq-start]")).toBeNull();
    expect(items[3].textContent).toContain("沒有作答");

    await vi.advanceTimersByTimeAsync(30_999);
    expect(rpc).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("items 只有一題時照舊顯示單題畫面", async () => {
    const rpc = vi.fn(async () => ({
      success: true,
      data: {
        status: "answered", questionId: "q1", isCorrect: false, elapsedMs: 1000, secondsUntilEnd: 30,
        items: [{ status: "answered", questionId: "q1", isCorrect: false, elapsedMs: 1000, secondsUntilEnd: 30 }]
      }
    }));
    setupGlobals(rpc);
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs");

    await refreshLightningQuizHomeCard();
    const host = document.getElementById("lightning-quiz-host");
    expect(host.querySelector(".lightning-quiz-multi")).toBeNull();
    expect(host.querySelector(".lightning-quiz-result.is-wrong")).not.toBeNull();
  });
});
