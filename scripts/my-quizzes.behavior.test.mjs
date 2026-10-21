import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

let dom;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setupDom(html) {
  dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://example.test/" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("localStorage", dom.window.localStorage);
  vi.stubGlobal("sessionStorage", dom.window.sessionStorage);
  vi.stubGlobal("escapeHTML", value => String(value ?? ""));
  vi.stubGlobal("hydrateIcons", () => {});
  vi.stubGlobal("showToast", vi.fn());
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  dom?.window.close();
});

describe("quiz-review 檢討畫面", () => {
  beforeEach(() => { vi.resetModules(); setupDom(""); });

  it("選擇題標出你選的與正解；答錯的列用紅框", async () => {
    const { renderQuestionReviewHtml } = await import("../js/modules/quiz-review.mjs?choices");
    document.body.innerHTML = renderQuestionReviewHtml(
      { type: "single", payload: { stem: "摩西的哥哥？", options: ["約書亞", "亞倫", "迦勒"] }, answerKey: 1 },
      { response: 0, result: "wrong" }
    );
    const items = [...document.querySelectorAll("li")];
    expect(document.querySelector(".exam-result__row--wrong")).not.toBeNull();
    expect(items[0].className).toBe("is-mine");
    expect(items[0].textContent).toContain("你選的");
    expect(items[1].className).toBe("is-right");
    expect(items[1].textContent).toContain("正解");
  });

  it("未參與只顯示正解；是非題的正解「錯」不會被當成沒答案", async () => {
    const { renderQuestionReviewHtml } = await import("../js/modules/quiz-review.mjs?unanswered");
    document.body.innerHTML = renderQuestionReviewHtml(
      { type: "truefalse", payload: { stem: "約拿被鯨魚吞了三天三夜？" }, answerKey: false },
      { response: null, result: "not_participated" }
    );
    expect(document.body.textContent).toContain("未參與");
    expect(document.body.textContent).not.toContain("你選的");
    const items = [...document.querySelectorAll("li")];
    expect(items[1].className).toBe("is-right");
  });

  it("排序題列出你的順序（標出錯的位置）與正確順序", async () => {
    const { renderQuestionReviewHtml } = await import("../js/modules/quiz-review.mjs?ordering");
    const payload = { stem: "依序排列", items: [{ id: "a", text: "創世記" }, { id: "b", text: "出埃及記" }, { id: "c", text: "利未記" }] };
    document.body.innerHTML = renderQuestionReviewHtml(
      { type: "ordering", payload, answerKey: ["a", "b", "c"] },
      { response: ["a", "c", "b"], result: "wrong" }
    );
    expect(document.body.textContent).toContain("你的順序");
    expect(document.body.textContent).toContain("正確順序");
    expect(document.body.textContent).toContain("應在第 3 個");
  });

  it("連連看畫出你的綠線，連錯的地方補紅色虛線正解", async () => {
    const { renderQuestionReviewHtml, paintMatchReviewLines } = await import("../js/modules/quiz-review.mjs?matching");
    const payload = { stem: "配對", left: [{ id: "L1", text: "摩西" }, { id: "L2", text: "大衛" }], right: [{ id: "R1", text: "十誡" }, { id: "R2", text: "詩篇" }] };
    document.body.innerHTML = renderQuestionReviewHtml(
      { type: "matching", payload, answerKey: { L1: "R1", L2: "R2" } },
      { response: { L1: "R2", L2: "R1" }, result: "wrong" }
    );
    // jsdom 沒有版面：給每個元素一個非零的方框，畫線程式才量得到點的位置。
    vi.spyOn(dom.window.Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 10, width: 100, height: 20 });
    paintMatchReviewLines(document.body);
    const lines = [...document.querySelectorAll(".match-lines line")];
    expect(lines).toHaveLength(4); // 兩條你的線 + 兩條更正
    expect(lines.filter(line => line.getAttribute("stroke-dasharray"))).toHaveLength(2);
    expect(lines.filter(line => !line.getAttribute("stroke-dasharray")).every(line => line.getAttribute("stroke").includes("success"))).toBe(true);
  });
});

describe("首頁雲柱測驗：活動結束就撤掉", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    setupDom('<div id="lightning-quiz-card" class="hidden"><div id="lightning-quiz-host"></div></div>');
  });

  it("已作答的結果顯示到活動結束，時間一到自己重新整理並收起卡片", async () => {
    const responses = [
      { success: true, data: { status: "answered", isCorrect: true, elapsedMs: 4200, secondsUntilEnd: 60 } },
      { success: true, data: { status: "hidden" } }
    ];
    vi.stubGlobal("db", { getTodaysLightningQuiz: vi.fn(async () => responses.shift()) });
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs?home-end");
    await refreshLightningQuizHomeCard();
    const card = document.getElementById("lightning-quiz-card");
    expect(card.classList.contains("hidden")).toBe(false);
    expect(card.textContent).toContain("答對了");
    // #323：送出後結果畫面也有飄動雲朵和「雲柱測驗」標題，一直留到活動結束
    expect(card.querySelectorAll(".lightning-quiz-result .lq-drift-cloud")).toHaveLength(2);
    expect(card.querySelector(".lightning-quiz-result .card-title").textContent).toBe("雲柱測驗");

    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(card.querySelectorAll(".lq-drift-cloud")).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(31 * 1000);
    expect(db.getTodaysLightningQuiz).toHaveBeenCalledTimes(2);
    expect(card.classList.contains("hidden")).toBe(true);
  });

  it("重新打開 App 時，已作答（答錯）也顯示雲朵與結果", async () => {
    vi.stubGlobal("db", {
      getTodaysLightningQuiz: vi.fn(async () => ({
        success: true, data: { status: "answered", isCorrect: false, elapsedMs: 9100, secondsUntilEnd: 600 }
      }))
    });
    const { refreshLightningQuizHomeCard } = await import("../js/modules/lightning-quiz.mjs?home-reopen");
    await refreshLightningQuizHomeCard();
    const card = document.getElementById("lightning-quiz-card");
    expect(card.querySelector(".lightning-quiz-result.is-wrong")).not.toBeNull();
    expect(card.querySelectorAll(".lq-drift-cloud")).toHaveLength(2);
    expect(card.querySelector(".lightning-quiz-result__verdict").textContent).toContain("答錯了");
    expect(card.textContent).toContain("9.1 秒");
  });
});

describe("雲柱測驗改名（#323）", () => {
  it("會友看得到的畫面與訊息不再出現舊名「快問快答」", async () => {
    const { readFileSync } = await import("node:fs");
    const stripComments = text => text
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const file of ["index.html", "js/db.js", "js/modules/admin.js", "js/modules/profile.js", "js/modules/lightning-quiz.mjs"]) {
      const source = stripComments(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
      expect(source, file).not.toContain("快問快答");
    }
  });
});

describe("個人「我的測驗」分頁", () => {
  const subpage = `
    <div id="profile-tab-content-exams" class="profile-subpage hidden">
      <button type="button" id="profile-exams-refresh">重新整理</button>
      <div id="profile-exams-browser">
        <button type="button" class="segment-toggle-btn active" data-profile-exams-tab="exam">大測驗</button>
        <button type="button" class="segment-toggle-btn" data-profile-exams-tab="daily">小測驗</button>
        <button type="button" class="segment-toggle-btn" data-profile-exams-tab="lightning">雲柱測驗</button>
        <section data-profile-exams-panel="exam"><div id="profile-exams-list"></div></section>
        <section data-profile-exams-panel="daily" class="hidden"><div id="profile-daily-quiz-results"></div></section>
        <section data-profile-exams-panel="lightning" class="hidden"><div id="profile-lightning-quiz-results"></div></section>
      </div>
      <div id="profile-exams-detail" class="hidden">
        <button type="button" id="profile-exams-detail-back">返回列表</button>
        <div id="profile-exams-detail-body"></div>
      </div>
    </div>`;

  beforeEach(() => {
    vi.resetModules();
    setupDom(subpage);
    vi.stubGlobal("firstPaint", () => false);
    vi.stubGlobal("state", {
      currentUser: { id: "u1", name: "測試" },
      activePlan: { id: "plan-1", globalPlanId: "plan-1" },
      offlineMode: false,
      theme: "light"
    });
    vi.stubGlobal("db", {
      getMyExamPapers: vi.fn(async () => ({ data: [] })),
      getMyDailyQuizResults: vi.fn(async () => ({
        success: true,
        results: [{
          quizDate: "2026-09-24", score: 1, total: 2, timeSeconds: 75,
          questions: [
            { id: "q1", type: "single", payload: { stem: "第一題", options: ["甲", "乙"] }, answerKey: 0 },
            { id: "q2", type: "truefalse", payload: { stem: "第二題" }, answerKey: true }
          ],
          answers: [
            { questionId: "q1", response: 0, correct: true },
            { questionId: "q2", response: false, correct: false }
          ]
        }]
      })),
      getMyLightningQuizHistory: vi.fn(async () => ({
        success: true,
        data: [{
          questionId: "lq1", riseDate: "2026-09-24", questionType: "single",
          payload: { stem: "雲柱測驗題目", options: ["A", "B"] }, answerKey: 1,
          result: "not_participated", response: null, elapsedMs: null
        }]
      }))
    });
  });

  it("三個分頁各自條列，點進去才看到逐題結果，返回回到清單", async () => {
    const profile = await import("../js/modules/profile.js?my-quizzes");
    profile.init();
    document.getElementById("profile-exams-refresh").click();
    await flush();

    expect(db.getMyDailyQuizResults.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [, from, to] = db.getMyDailyQuizResults.mock.calls[0];
    expect((Date.parse(to) - Date.parse(from)) / 86400000).toBe(6); // 最近一週（含今天）

    document.querySelector('[data-profile-exams-tab="daily"]').click();
    expect(document.querySelector('[data-profile-exams-panel="daily"]').classList.contains("hidden")).toBe(false);
    expect(document.querySelector('[data-profile-exams-panel="exam"]').classList.contains("hidden")).toBe(true);

    const dailyRow = document.querySelector('#profile-daily-quiz-results [data-profile-exams-kind="daily"]');
    expect(dailyRow.textContent).toContain("1／2");
    expect(document.getElementById("profile-exams-detail-body").textContent).toBe("");
    dailyRow.click();
    const detail = document.getElementById("profile-exams-detail-body");
    expect(document.getElementById("profile-exams-browser").classList.contains("hidden")).toBe(true);
    expect(detail.textContent).toContain("第 1 題");
    expect(detail.querySelector(".exam-result__row--correct")).not.toBeNull();
    expect(detail.querySelector(".exam-result__row--wrong")).not.toBeNull();

    document.getElementById("profile-exams-detail-back").click();
    expect(document.getElementById("profile-exams-browser").classList.contains("hidden")).toBe(false);

    document.querySelector('[data-profile-exams-tab="lightning"]').click();
    document.querySelector('#profile-lightning-quiz-results [data-profile-exams-kind="lightning"]').click();
    expect(detail.textContent).toContain("未參與");
    expect(detail.textContent).toContain("正解");
  });
});

// #612：選單題的檢討畫面——每個項目列出你選的數量與正確數量，不一樣的標出來
describe("quiz-review 選單題（#612）", () => {
  beforeEach(() => { vi.resetModules(); setupDom(""); });
  const question = {
    type: "menu",
    payload: { stem: "每種潔淨的動物帶幾隻？", items: [{ id: "I1", text: "牛" }, { id: "I2", text: "羊" }, { id: "I3", text: "豬" }] },
    answerKey: { I1: 7, I2: 7 }
  };

  it("每個項目列出你選的與正確數量，對的標綠、錯的補正解", async () => {
    const { renderQuestionReviewHtml } = await import("../js/modules/quiz-review.mjs?menu");
    document.body.innerHTML = renderQuestionReviewHtml(question, { response: { I1: 7, I3: 2 }, result: "wrong" });
    const items = [...document.querySelectorAll("li")];
    expect(items.map(li => li.textContent.replace(/\s+/g, " ").trim())).toEqual([
      "牛 你選 7 個",
      "羊 你選 0 個 正解 7 個",
      "豬 你選 2 個 正解 0 個"
    ]);
    expect(items[0].className).toBe("is-mine");
    expect(items[1].className).toBe("");
  });

  it("沒有作答只列出正解數量大於 0 的項目", async () => {
    const { renderQuestionReviewHtml } = await import("../js/modules/quiz-review.mjs?menu-unanswered");
    document.body.innerHTML = renderQuestionReviewHtml(question, { response: null, result: "not_participated" });
    const items = [...document.querySelectorAll("li")].map(li => li.textContent.replace(/\s+/g, " ").trim());
    expect(items).toEqual(["牛 ×7", "羊 ×7"]);
  });
});
