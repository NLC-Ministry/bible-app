// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import {
  normalizeQuestion,
  isResponseComplete,
  isAnswerCorrect,
  renderQuestionFieldsetHtml,
  readResponseFromFieldset,
  bindQuestionFieldset,
  isSupportedQuestionType,
  formatResponseForDisplay
  ,shuffleMatchingItems
} from "./quiz-question-types.mjs";

describe("normalizeQuestion", () => {
  it("passes through an already type-aware question", () => {
    const result = normalizeQuestion({
      id: "q1", type: "truefalse", payload: { stem: "挪亞方舟載了七種潔淨動物各七隻" }, answerKey: true
    });
    expect(result).toEqual({
      id: "q1", type: "truefalse", payload: { stem: "挪亞方舟載了七種潔淨動物各七隻" },
      answerKey: true, explanation: "", verseRef: ""
    });
  });

  it("adapts a legacy AI-generated single-choice question", () => {
    const result = normalizeQuestion({
      id: "legacy-1", question: "亞伯拉罕原本住在哪座城市？",
      options: ["哈蘭", "吾珥", "伯特利", "示劍"], correctIndex: 1,
      explanation: "創世記 11:31", verseRef: "創世記 11:31"
    });
    expect(result.type).toBe("single");
    expect(result.payload).toEqual({ stem: "亞伯拉罕原本住在哪座城市？", options: ["哈蘭", "吾珥", "伯特利", "示劍"] });
    expect(result.answerKey).toBe(1);
  });

  it("rejects an unsupported type", () => {
    expect(() => normalizeQuestion({ id: "q1", type: "shortanswer", payload: {} })).toThrow(/unsupported_question_type/);
  });

  it("rejects an unrecognized shape", () => {
    expect(() => normalizeQuestion({ id: "q1" })).toThrow(/unrecognized_question_shape/);
  });

  it("adapts a pre-attempt legacy question whose correctIndex the server has stripped (quiz_questions_for_member with p_include_answers=false)", () => {
    // 這是曾經真的壞掉的情境：作答前伺服器不會回傳 correctIndex，
    // 如果判斷「是不是舊格式」的邏輯依賴 correctIndex 存在，會導致每一份
    // 還沒作答的既有小測驗（AI 產生）整個渲染失敗。
    const result = normalizeQuestion({
      id: "legacy-2", question: "誰帶領以色列人出埃及？",
      options: ["摩西", "約書亞", "大衛", "所羅門"], verseRef: "出埃及記 3:10"
    });
    expect(result.type).toBe("single");
    expect(result.payload.options).toEqual(["摩西", "約書亞", "大衛", "所羅門"]);
    expect(result.answerKey).toBeNull();
  });
});

describe("matching layout", () => {
  it("shuffles items with Fisher-Yates without mutating the source", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const shuffled = shuffleMatchingItems(items, () => 0);
    expect(shuffled.map(item => item.id)).toEqual(["2", "3", "1"]);
    expect(items.map(item => item.id)).toEqual(["1", "2", "3"]);
  });
});

describe("isResponseComplete", () => {
  it("truefalse requires an actual boolean", () => {
    expect(isResponseComplete("truefalse", null)).toBe(false);
    expect(isResponseComplete("truefalse", false)).toBe(true);
    expect(isResponseComplete("truefalse", true)).toBe(true);
  });

  it("single requires a non-negative integer", () => {
    expect(isResponseComplete("single", null)).toBe(false);
    expect(isResponseComplete("single", 0)).toBe(true);
  });

  it("multiple requires a non-empty array", () => {
    expect(isResponseComplete("multiple", [])).toBe(false);
    expect(isResponseComplete("multiple", [0, 2])).toBe(true);
  });

  it("matching requires a pair for every left item", () => {
    const payload = { left: [{ id: "L1" }, { id: "L2" }] };
    expect(isResponseComplete("matching", { L1: "R1" }, payload)).toBe(false);
    expect(isResponseComplete("matching", { L1: "R1", L2: "R2" }, payload)).toBe(true);
  });

  it("ordering requires every item placed", () => {
    const payload = { items: [{ id: "I1" }, { id: "I2" }, { id: "I3" }] };
    expect(isResponseComplete("ordering", ["I1", "I2"], payload)).toBe(false);
    expect(isResponseComplete("ordering", ["I1", "I2", "I3"], payload)).toBe(true);
  });
});

describe("isAnswerCorrect (client-side mirror of SQL _quiz_answer_is_correct)", () => {
  it("truefalse / single compare by strict equality", () => {
    expect(isAnswerCorrect("truefalse", true, true)).toBe(true);
    expect(isAnswerCorrect("truefalse", true, false)).toBe(false);
    expect(isAnswerCorrect("single", 2, 2)).toBe(true);
    expect(isAnswerCorrect("single", 2, 1)).toBe(false);
  });

  it("multiple ignores order but not membership", () => {
    expect(isAnswerCorrect("multiple", [0, 2], [2, 0])).toBe(true);
    expect(isAnswerCorrect("multiple", [0, 2], [0, 1])).toBe(false);
    expect(isAnswerCorrect("multiple", [0, 2], [0])).toBe(false);
  });

  it("matching compares the pairing object regardless of key order", () => {
    expect(isAnswerCorrect("matching", { L1: "R1", L2: "R2" }, { L2: "R2", L1: "R1" })).toBe(true);
    expect(isAnswerCorrect("matching", { L1: "R1", L2: "R2" }, { L1: "R2", L2: "R1" })).toBe(false);
  });

  it("ordering is order-sensitive", () => {
    expect(isAnswerCorrect("ordering", ["I1", "I2", "I3"], ["I1", "I2", "I3"])).toBe(true);
    expect(isAnswerCorrect("ordering", ["I1", "I2", "I3"], ["I2", "I1", "I3"])).toBe(false);
  });

  it("returns false when either side is missing", () => {
    expect(isAnswerCorrect("single", null, 1)).toBe(false);
    expect(isAnswerCorrect("single", 1, null)).toBe(false);
  });
});

describe("render + read + bind round-trip (jsdom)", () => {
  function mount(html) {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    return container.querySelector("fieldset");
  }

  it("single: renders options and reads back the checked one", () => {
    const question = normalizeQuestion({ id: "s1", type: "single", payload: { stem: "誰帶領以色列人出埃及？", options: ["摩西", "約書亞", "大衛", "所羅門"] }, answerKey: 0 });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    expect(fieldset.querySelectorAll("input[type=radio]").length).toBe(4);

    let lastResponse;
    bindQuestionFieldset(fieldset, "single", response => { lastResponse = response; });
    fieldset.querySelectorAll("input[type=radio]")[0].click();
    expect(lastResponse).toBe(0);
    expect(readResponseFromFieldset(fieldset, "single")).toBe(0);
  });

  it("truefalse: renders two radios and reads boolean", () => {
    const question = normalizeQuestion({ id: "t1", type: "truefalse", payload: { stem: "大衛打敗了歌利亞" }, answerKey: true });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    let lastResponse;
    bindQuestionFieldset(fieldset, "truefalse", response => { lastResponse = response; });
    fieldset.querySelector('input[value="true"]').click();
    expect(lastResponse).toBe(true);
  });

  it("multiple: reads back all checked indices", () => {
    const question = normalizeQuestion({ id: "m1", type: "multiple", payload: { stem: "以下哪些是舊約先知書？", options: ["以賽亞書", "詩篇", "耶利米書", "箴言"] }, answerKey: [0, 2] });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    let lastResponse;
    bindQuestionFieldset(fieldset, "multiple", response => { lastResponse = response; });
    const checkboxes = fieldset.querySelectorAll("input[type=checkbox]");
    checkboxes[0].click();
    checkboxes[2].click();
    expect(lastResponse.sort()).toEqual([0, 2]);
  });

  it("matching: click left then right pairs them, click paired left again unpairs", () => {
    const question = normalizeQuestion({
      id: "match1", type: "matching",
      payload: {
        stem: "配對人物與地點",
        left: [{ id: "L1", text: "亞伯拉罕" }, { id: "L2", text: "摩西" }],
        right: [{ id: "R1", text: "吾珥" }, { id: "R2", text: "米甸" }]
      },
      answerKey: { L1: "R1", L2: "R2" }
    });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    expect(fieldset.querySelector(".daily-quiz-match-lines")).not.toBeNull();
    expect(fieldset.querySelectorAll(".daily-quiz-match-dot").length).toBe(4);
    let lastResponse;
    bindQuestionFieldset(fieldset, "matching", response => { lastResponse = response; });

    fieldset.querySelector('[data-left-id="L1"]').click();
    fieldset.querySelector('[data-right-id="R1"]').click();
    expect(lastResponse).toEqual({ L1: "R1" });

    fieldset.querySelector('[data-left-id="L2"]').click();
    fieldset.querySelector('[data-right-id="R2"]').click();
    expect(lastResponse).toEqual({ L1: "R1", L2: "R2" });

    // clicking the already-paired left again should unpair it
    fieldset.querySelector('[data-left-id="L1"]').click();
    expect(lastResponse).toEqual({ L2: "R2" });
  });

  it("ordering: up/down buttons reorder the list", () => {
    const question = normalizeQuestion({
      id: "order1", type: "ordering",
      payload: { stem: "依事件發生順序排列", items: [{ id: "I1", text: "創造天地" }, { id: "I2", text: "挪亞洪水" }, { id: "I3", text: "巴別塔" }] },
      answerKey: ["I1", "I2", "I3"]
    });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    let lastResponse;
    bindQuestionFieldset(fieldset, "ordering", response => { lastResponse = response; });

    // move the 3rd item ("I3") up once -> I1, I3, I2
    const thirdItem = fieldset.querySelectorAll("li")[2];
    thirdItem.querySelector("[data-order-up]").click();
    expect(lastResponse).toEqual(["I1", "I3", "I2"]);
  });
});

describe("formatResponseForDisplay", () => {
  it("shows 未作答 for a null/undefined response", () => {
    expect(formatResponseForDisplay("single", { options: ["A"] }, null)).toBe("未作答");
    expect(formatResponseForDisplay("single", { options: ["A"] }, undefined)).toBe("未作答");
  });

  it("truefalse / single / multiple resolve to their text labels", () => {
    expect(formatResponseForDisplay("truefalse", {}, true)).toBe("對");
    expect(formatResponseForDisplay("truefalse", {}, false)).toBe("錯");
    expect(formatResponseForDisplay("single", { options: ["摩西", "約書亞"] }, 0)).toBe("摩西");
    expect(formatResponseForDisplay("multiple", { options: ["以賽亞書", "詩篇", "耶利米書"] }, [0, 2])).toBe("以賽亞書、耶利米書");
  });

  it("matching formats each pair as left→right text", () => {
    const payload = {
      left: [{ id: "L1", text: "亞伯拉罕" }],
      right: [{ id: "R1", text: "吾珥" }]
    };
    expect(formatResponseForDisplay("matching", payload, { L1: "R1" })).toBe("亞伯拉罕→吾珥");
  });

  it("ordering joins item text in response order", () => {
    const payload = { items: [{ id: "I1", text: "創造天地" }, { id: "I2", text: "挪亞洪水" }] };
    expect(formatResponseForDisplay("ordering", payload, ["I2", "I1"])).toBe("挪亞洪水 → 創造天地");
  });
});

describe("isSupportedQuestionType", () => {
  it("accepts exactly the five auto-graded types, not shortanswer", () => {
    expect(isSupportedQuestionType("single")).toBe(true);
    expect(isSupportedQuestionType("shortanswer")).toBe(false);
  });
});
