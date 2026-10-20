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
  formatResponseForDisplay,
  shuffleItems,
  createSeededRandom,
  arrangeOrderingItems,
  arrangeMatchingColumns
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

describe("shuffling", () => {
  it("shuffles items with Fisher-Yates without mutating the source", () => {
    const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const shuffled = shuffleItems(items, () => 0);
    expect(shuffled.map(item => item.id)).toEqual(["2", "3", "1"]);
    expect(items.map(item => item.id)).toEqual(["1", "2", "3"]);
  });

  it("a seeded random repeats for the same seed and differs across seeds", () => {
    const draw = seed => { const random = createSeededRandom(seed); return [random(), random(), random()]; };
    expect(draw("member-a:q1")).toEqual(draw("member-a:q1"));
    expect(draw("member-a:q1")).not.toEqual(draw("member-b:q1"));
    draw("member-a:q1").forEach(value => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); });
    expect(createSeededRandom(null)).toBe(Math.random);
  });

  const ids = n => Array.from({ length: n }, (_, index) => ({ id: `I${index + 1}` }));

  it("ordering never starts with any item already in its correct position", () => {
    for (let n = 2; n <= 6; n += 1) {
      for (let seed = 0; seed < 200; seed += 1) {
        const arranged = arrangeOrderingItems(ids(n), createSeededRandom(`s${seed}`));
        expect(arranged.map(item => item.id).sort()).toEqual(ids(n).map(item => item.id).sort());
        arranged.forEach((item, position) => expect(item.id).not.toBe(`I${position + 1}`));
      }
    }
  });

  it("ordering with 4+ items avoids adjacent pairs already in correct sequence", () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const arranged = arrangeOrderingItems(ids(5), createSeededRandom(`s${seed}`)).map(item => Number(item.id.slice(1)));
      const adjacent = arranged.filter((value, position) => position > 0 && arranged[position - 1] + 1 === value).length;
      expect(adjacent).toBe(0);
    }
  });

  it("matching never lines up a left item with its own partner on the same row", () => {
    for (let n = 2; n <= 6; n += 1) {
      const left = Array.from({ length: n }, (_, index) => ({ id: `L${index + 1}` }));
      const right = Array.from({ length: n }, (_, index) => ({ id: `R${index + 1}` }));
      for (let seed = 0; seed < 200; seed += 1) {
        const columns = arrangeMatchingColumns(left, right, createSeededRandom(`s${seed}`));
        expect(columns.left).toHaveLength(n);
        expect(columns.right).toHaveLength(n);
        columns.left.forEach((item, row) => expect(columns.right[row].id.slice(1)).not.toBe(item.id.slice(1)));
      }
    }
  });

  it("matching with fewer right points than left items keeps every item and shuffles the right column (#588)", () => {
    const left = Array.from({ length: 4 }, (_, index) => ({ id: `L${index + 1}` }));
    const right = [{ id: "R1" }, { id: "R2" }];
    const rightOrders = new Set();
    for (let seed = 0; seed < 50; seed += 1) {
      const columns = arrangeMatchingColumns(left, right, createSeededRandom(`s${seed}`));
      expect(columns.left.map(item => item.id).sort()).toEqual(["L1", "L2", "L3", "L4"]);
      expect(columns.right.map(item => item.id).sort()).toEqual(["R1", "R2"]);
      rightOrders.add(columns.right.map(item => item.id).join(","));
    }
    expect(rightOrders.size).toBe(2);
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
    fieldset.querySelector('input[value="0"]').click();
    expect(lastResponse).toBe(0);
    expect(readResponseFromFieldset(fieldset, "single")).toBe(0);
  });

  it("single / multiple: display order is shuffled but each value keeps its original option index", () => {
    const options = ["摩西", "約書亞", "大衛", "所羅門", "撒母耳", "以利亞"];
    const question = normalizeQuestion({ id: "s2", type: "single", payload: { stem: "?", options }, answerKey: 0 });
    const orders = new Set();
    for (let seed = 0; seed < 20; seed += 1) {
      const fieldset = mount(renderQuestionFieldsetHtml(question, 0, { shuffleSeed: `member-${seed}` }));
      const labels = Array.from(fieldset.querySelectorAll("label"));
      labels.forEach(label => {
        expect(label.textContent.trim()).toBe(options[Number(label.querySelector("input").value)]);
      });
      orders.add(labels.map(label => label.querySelector("input").value).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("the same shuffleSeed re-renders every type in the same order", () => {
    const questions = [
      { id: "a", type: "single", payload: { stem: "?", options: ["1", "2", "3", "4", "5"] } },
      { id: "b", type: "multiple", payload: { stem: "?", options: ["1", "2", "3", "4", "5"] } },
      { id: "c", type: "ordering", payload: { stem: "?", items: [{ id: "I1", text: "1" }, { id: "I2", text: "2" }, { id: "I3", text: "3" }, { id: "I4", text: "4" }] } },
      { id: "d", type: "matching", payload: { stem: "?", left: [{ id: "L1", text: "a" }, { id: "L2", text: "b" }, { id: "L3", text: "c" }], right: [{ id: "R1", text: "x" }, { id: "R2", text: "y" }, { id: "R3", text: "z" }] } }
    ].map(normalizeQuestion);
    questions.forEach(question => {
      expect(renderQuestionFieldsetHtml(question, 0, { shuffleSeed: "member-a:2026-09-27" }))
        .toBe(renderQuestionFieldsetHtml(question, 0, { shuffleSeed: "member-a:2026-09-27" }));
    });
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
    fieldset.querySelector('input[value="0"]').click();
    fieldset.querySelector('input[value="2"]').click();
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
    expect(fieldset.querySelector(".daily-quiz-match-lines")).toBeNull();
    expect(fieldset.querySelectorAll(".daily-quiz-match-dot").length).toBe(4);
    let lastResponse;
    bindQuestionFieldset(fieldset, "matching", response => { lastResponse = response; });
    // 連線用的 SVG 是 bindQuestionFieldset 動態插入的（見 quiz-question-types.mjs
    // 的 icon-audit 註解），綁定完成後才會出現。
    expect(fieldset.querySelector(".daily-quiz-match-lines")).not.toBeNull();

    fieldset.querySelector('[data-left-id="L1"]').click();
    fieldset.querySelector('[data-right-id="R1"]').click();
    expect(lastResponse).toEqual({ L1: "R1" });

    fieldset.querySelector('[data-left-id="L2"]').click();
    fieldset.querySelector('[data-right-id="R2"]').click();
    expect(lastResponse).toEqual({ L1: "R1", L2: "R2" });

    // clicking the already-paired left again should unpair it
    fieldset.querySelector('[data-left-id="L1"]').click();
    expect(lastResponse).toEqual({ L2: "R2" });

    // 一對一題目：右邊點被第二條線連上時，前一條線照舊被拆掉，也沒有多對一提示
    fieldset.querySelector('[data-left-id="L1"]').click();
    fieldset.querySelector('[data-right-id="R2"]').click();
    expect(lastResponse).toEqual({ L1: "R2" });
    expect(fieldset.querySelector("[data-matching-many-to-one]")).toBeNull();
    expect(fieldset.querySelector(".daily-quiz-match-hint")).toBeNull();
  });

  it("matching with fewer right points: several left items can share one right point (#588)", () => {
    const question = normalizeQuestion({
      id: "match-many", type: "matching",
      payload: {
        stem: "配對人物與身分",
        left: [{ id: "L1", text: "彼得" }, { id: "L2", text: "安得烈" }, { id: "L3", text: "馬太" }],
        right: [{ id: "R1", text: "加利利漁夫" }, { id: "R2", text: "稅吏" }]
      },
      answerKey: { L1: "R1", L2: "R1", L3: "R2" }
    });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    expect(fieldset.querySelector("[data-matching-many-to-one]")).not.toBeNull();
    expect(fieldset.querySelector(".daily-quiz-match-hint")?.textContent).toMatch(/重複連/);
    let lastResponse;
    bindQuestionFieldset(fieldset, "matching", response => { lastResponse = response; });
    const pair = (leftId, rightId) => {
      fieldset.querySelector(`[data-left-id="${leftId}"]`).click();
      fieldset.querySelector(`[data-right-id="${rightId}"]`).click();
    };
    const r1 = fieldset.querySelector('[data-right-id="R1"]');

    pair("L1", "R1");
    pair("L2", "R1");
    pair("L3", "R2");
    expect(lastResponse).toEqual({ L1: "R1", L2: "R1", L3: "R2" });
    expect(isAnswerCorrect("matching", question.answerKey, lastResponse)).toBe(true);
    expect(fieldset.querySelectorAll(".daily-quiz-match-line")).toHaveLength(3);

    // 拆掉其中一條，R1 還有另一條線 → 仍是 is-paired
    fieldset.querySelector('[data-left-id="L1"]').click();
    expect(lastResponse).toEqual({ L2: "R1", L3: "R2" });
    expect(r1.classList.contains("is-paired")).toBe(true);
    // 最後一條也拆掉 → R1 不再 is-paired
    fieldset.querySelector('[data-left-id="L2"]').click();
    expect(r1.classList.contains("is-paired")).toBe(false);
    expect(lastResponse).toEqual({ L3: "R2" });
  });

  it("ordering: answer area starts empty; tap pool items to place them, ✕ sends one back", () => {
    const question = normalizeQuestion({
      id: "order1", type: "ordering",
      payload: { stem: "依事件發生順序排列", items: [{ id: "I1", text: "創造天地" }, { id: "I2", text: "挪亞洪水" }, { id: "I3", text: "巴別塔" }] },
      answerKey: ["I1", "I2", "I3"]
    });
    const fieldset = mount(renderQuestionFieldsetHtml(question, 0));
    let lastResponse;
    bindQuestionFieldset(fieldset, "ordering", response => { lastResponse = response; });
    const tap = id => {
      const chip = fieldset.querySelector(`[data-order-pool] [data-item-id="${id}"]`);
      chip.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
      chip.dispatchEvent(new Event("pointerup", { bubbles: true }));
    };

    expect(readResponseFromFieldset(fieldset, "ordering")).toEqual([]);
    expect(fieldset.querySelectorAll("[data-order-pool] [data-item-id]")).toHaveLength(3);
    expect(isResponseComplete("ordering", [], question.payload)).toBe(false);

    tap("I2");
    tap("I1");
    expect(lastResponse).toEqual(["I2", "I1"]);
    expect(fieldset.querySelectorAll("[data-order-answer] .exam-order-num")[1].textContent).toBe("2");
    expect(fieldset.querySelectorAll("[data-order-pool] [data-item-id]")).toHaveLength(1);

    fieldset.querySelector('[data-order-answer] [data-item-id="I2"] .exam-chip-remove').click();
    expect(lastResponse).toEqual(["I1"]);
    tap("I2");
    tap("I3");
    expect(lastResponse).toEqual(["I1", "I2", "I3"]);
    expect(isResponseComplete("ordering", lastResponse, question.payload)).toBe(true);
    expect(fieldset.querySelector("[data-order-pool] .exam-order-empty")).not.toBeNull();
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
