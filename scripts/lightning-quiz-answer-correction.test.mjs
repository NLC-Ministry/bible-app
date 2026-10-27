// #616：雲柱題目開始後更正正解／詳解的表單（純函式）。伺服器端的重判與形狀檢查在 db-behavior.test.mjs。
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import {
  lightningAnswerCorrectionNote,
  lightningCorrectionResultMessage,
  readLightningCorrectionAnswerKey,
  renderLightningAnswerCorrectionHtml
} from "../js/modules/lightning-quiz-answer-correction.mjs";

function formOf(question) {
  const dom = new JSDOM(`<!doctype html><body>${renderLightningAnswerCorrectionHtml(question)}</body>`);
  return dom.window.document.querySelector("[data-lq-correct-form]");
}

const single = { id: "q", questionType: "single", payload: { stem: "誰？", options: ["甲", "乙", "丙"] }, answerKey: 1, explanation: "舊詳解" };

describe("雲柱更正正解表單", () => {
  it("單選：預設勾目前的正解、帶入原本的詳解，改選後讀出新的索引", () => {
    const form = formOf(single);
    expect(form.querySelector('[data-lq-correct-choice][value="1"]').checked).toBe(true);
    expect(form.querySelector("[data-lq-correct-explanation]").value).toBe("舊詳解");
    form.querySelector('[data-lq-correct-choice][value="2"]').checked = true;
    expect(readLightningCorrectionAnswerKey(form, "single")).toBe(2);
  });

  it("是非與多選", () => {
    const tf = formOf({ ...single, questionType: "truefalse", payload: { stem: "對嗎" }, answerKey: true });
    tf.querySelector('[data-lq-correct-choice][value="false"]').checked = true;
    expect(readLightningCorrectionAnswerKey(tf, "truefalse")).toBe(false);

    const multiple = formOf({ ...single, questionType: "multiple", answerKey: [0] });
    multiple.querySelector('[data-lq-correct-choice][value="2"]').checked = true;
    expect(readLightningCorrectionAnswerKey(multiple, "multiple")).toEqual([0, 2]);
    multiple.querySelectorAll("[data-lq-correct-choice]").forEach(input => { input.checked = false; });
    expect(readLightningCorrectionAnswerKey(multiple, "multiple")).toBeNull();
  });

  it("配對：每個左邊都要選；多對一時提示右邊可以重複", () => {
    const payload = { stem: "配對", left: [{ id: "L1", text: "甲" }, { id: "L2", text: "乙" }], right: [{ id: "R1", text: "一" }] };
    const form = formOf({ ...single, questionType: "matching", payload, answerKey: { L1: "R1" } });
    expect(form.textContent).toContain("右邊可以重複選");
    expect(readLightningCorrectionAnswerKey(form, "matching")).toBeNull();
    form.querySelector('[data-lq-correct-match="L2"]').value = "R1";
    expect(readLightningCorrectionAnswerKey(form, "matching")).toEqual({ L1: "R1", L2: "R1" });
  });

  it("排序：照位置讀出 item id，重複就不收", () => {
    const payload = { stem: "排序", items: [{ id: "A", text: "甲" }, { id: "B", text: "乙" }] };
    const form = formOf({ ...single, questionType: "ordering", payload, answerKey: ["A", "B"] });
    expect(readLightningCorrectionAnswerKey(form, "ordering")).toEqual(["A", "B"]);
    form.querySelector('[data-lq-correct-order="0"]').value = "B";
    expect(readLightningCorrectionAnswerKey(form, "ordering")).toBeNull();
    form.querySelector('[data-lq-correct-order="1"]').value = "A";
    expect(readLightningCorrectionAnswerKey(form, "ordering")).toEqual(["B", "A"]);
  });

  it("選單：只留數量大於 0 的項目；全是 0、小數或超過上限都不收", () => {
    const payload = { stem: "點餐", items: [{ id: "I1", text: "麵包" }, { id: "I2", text: "魚" }] };
    const form = formOf({ ...single, questionType: "menu", payload, answerKey: { I1: 5 } });
    const input = id => form.querySelector(`[data-lq-correct-menu="${id}"]`);
    expect(input("I1").value).toBe("5");
    expect(input("I2").value).toBe("0");
    input("I2").value = "2";
    expect(readLightningCorrectionAnswerKey(form, "menu")).toEqual({ I1: 5, I2: 2 });
    input("I1").value = "0";
    input("I2").value = "";
    expect(readLightningCorrectionAnswerKey(form, "menu")).toBeNull();
    input("I1").value = "1.5";
    expect(readLightningCorrectionAnswerKey(form, "menu")).toBeNull();
    input("I1").value = "21";
    expect(readLightningCorrectionAnswerKey(form, "menu")).toBeNull();
  });

  it("題目文字會跳脫", () => {
    const form = formOf({ ...single, payload: { stem: "x", options: ["<b>甲</b>"] } });
    expect(form.innerHTML).not.toContain("<b>甲</b>");
  });
});

describe("更正後的訊息與標示", () => {
  it("結果訊息：沒變、只改詳解、重判筆數", () => {
    expect(lightningCorrectionResultMessage({ changed: false })).toBe("內容沒有變更。");
    expect(lightningCorrectionResultMessage({ changed: true, answerChanged: false })).toBe("詳解已更新。");
    expect(lightningCorrectionResultMessage({ changed: true, answerChanged: true, attemptsRescored: 42, becameCorrect: 3, becameWrong: 1 }))
      .toBe("已更正答案，重新判分 42 筆：3 人改成答對、1 人改成答錯。");
    expect(lightningCorrectionResultMessage({ changed: true, answerChanged: true, attemptsRescored: 0, becameCorrect: 0, becameWrong: 0 }))
      .toBe("已更正答案，重新判分 0 筆，對錯都沒有改變。");
  });

  it("後台面板的已更正標示帶原本的正解；沒更正過就不顯示", () => {
    expect(lightningAnswerCorrectionNote(single)).toBe("");
    expect(lightningAnswerCorrectionNote({ ...single, answerCorrectedAt: "2026-10-27T01:00:00Z", originalAnswerKey: 0 }))
      .toBe("答案已更正（原本的正解：甲）");
  });
});
