// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// #643：補發的小測驗顯示在會友「今天」的計畫頁。plan.js 很大又掛一堆 window 全域，
// 這裡只替換 plan-quiz.js 需要的兩個匯出。
const renderDailyQuizSection = vi.fn();
vi.mock("../js/modules/plan.js", () => ({
  getLastTrackerRequestId: () => 7,
  renderDailyQuizSection
}));
const { showDailyQuiz } = await import("../js/modules/plan-quiz.js");

const TODAY = "2026-10-28";
const QUESTIONS = [
  { id: "q1", type: "truefalse", payload: { stem: "第一題" } },
  { id: "q2", type: "truefalse", payload: { stem: "第二題" } }
];
const quiz = (publicationId, quizDate, extra = {}) => ({
  publicationId, quizDate, publisherRole: "admin", answerCloseAt: "2999-01-01T00:00:00Z",
  questions: QUESTIONS, attempt: null, ...extra
});
// 第一遍還沒讀完：要讀完那一天的章節才能作答
const plan = days => ({ id: "plan-1", currentRound: 1, days });
const day = (isoDate, read) => ({ isoDate, chapters: [{ book: "利未記", chapter: 26, round: 1, isReadR1: read }] });

function mount(context, options = {}, planDays = [day("2026-10-26", true)]) {
  document.body.innerHTML = '<section id="daily-quiz-section"><div id="daily-quiz-content"></div></section>';
  const section = document.getElementById("daily-quiz-section");
  const content = document.getElementById("daily-quiz-content");
  showDailyQuiz(section, content, context, plan(planDays), TODAY, options);
  return content;
}

beforeEach(() => {
  globalThis.state = { currentUser: { id: "user-1" } };
  globalThis.showToast = vi.fn();
  globalThis.hydrateIcons = vi.fn();
  globalThis.db = {
    submitDailyQuizAnswer: vi.fn(async () => ({ success: true })),
    finalizeDailyQuizAttempt: vi.fn(async () => ({ success: true, data: { score: 2, total: 2 } }))
  };
  renderDailyQuizSection.mockClear();
});

describe("補發的小測驗（#643）", () => {
  it("今天沒有自己的測驗時，只顯示補發那一份，標「補發：10/26 小測驗」", () => {
    const content = mount({ myQuiz: null, makeupQuizzes: [quiz("pub-26", "2026-10-26")] });
    const entries = content.querySelectorAll(".daily-quiz-entry-button");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("daily-quiz-entry-button");
    expect(entries[0].textContent).toContain("補發：10/26 小測驗");
    expect(entries[0].textContent).toContain("完成10/26的速讀進度後即可作答");
  });

  it("今天也有測驗時兩份都顯示，id 不重複", () => {
    const content = mount({ myQuiz: quiz("pub-28", TODAY), makeupQuizzes: [quiz("pub-26", "2026-10-26")] },
      {}, [day(TODAY, true), day("2026-10-26", true)]);
    const entries = Array.from(content.querySelectorAll(".daily-quiz-entry-button"));
    expect(entries.map(entry => entry.querySelector("strong").textContent)).toEqual(["小測驗", "補發：10/26 小測驗"]);
    const ids = Array.from(content.querySelectorAll("[id]")).map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("補發的進度檢查看原本那一天（10/26），不是今天", () => {
    const content = mount({ myQuiz: null, makeupQuizzes: [quiz("pub-26", "2026-10-26")] }, {}, [day("2026-10-26", false)]);
    content.querySelector(".daily-quiz-entry-button").click();
    expect(showToast).toHaveBeenCalledWith("請先閱讀完10/26的速讀進度，再進入小測驗（尚有 1 章）。");
    expect(content.querySelector("form")).toBeNull();
  });

  it("讀完那天就能進入作答；交卷後重畫今天這一區並展開剛交卷的那份", async () => {
    const content = mount({ myQuiz: null, makeupQuizzes: [quiz("pub-26", "2026-10-26")] });
    content.querySelector(".daily-quiz-entry-button").click();
    const form = content.querySelector("form");
    expect(form).not.toBeNull();
    expect(content.querySelector(".daily-quiz-eyebrow").textContent).toBe("補發：10/26 小測驗");
    form.querySelectorAll("fieldset[data-question-id]").forEach(fieldset => {
      const input = fieldset.querySelector("input");
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(renderDailyQuizSection).toHaveBeenCalled());
    expect(db.finalizeDailyQuizAttempt).toHaveBeenCalledWith("pub-26");
    expect(renderDailyQuizSection).toHaveBeenCalledWith(expect.anything(), { isoDate: TODAY }, 7,
      { open: true, openPublicationId: "pub-26" });
  });

  it("open + openPublicationId 只展開那一份，另一份維持入口", () => {
    const done = quiz("pub-26", "2026-10-26", { attempt: { score: 2, total: 2, answers: [] } });
    const content = mount({ myQuiz: quiz("pub-28", TODAY), makeupQuizzes: [done] },
      { open: true, openPublicationId: "pub-26" }, [day(TODAY, true), day("2026-10-26", true)]);
    const items = content.querySelectorAll("[data-daily-quiz-item]");
    expect(items[0].querySelector(".daily-quiz-entry-button")).not.toBeNull();
    expect(items[1].querySelector(".daily-quiz-score").textContent).toBe("2／2");
  });
});
