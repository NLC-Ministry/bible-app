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
});
