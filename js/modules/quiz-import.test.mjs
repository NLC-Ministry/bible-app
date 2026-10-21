import { describe, it, expect } from "vitest";
import { parseQuizImportText } from "./quiz-import.mjs";

describe("parseQuizImportText", () => {
  it("parses a single-choice block", () => {
    const { questions, errors } = parseQuizImportText(`
[單選] 亞伯拉罕原本住在哪座城市？
A. 哈蘭
B. 吾珥
C. 伯特利
D. 示劍
答案：B
    `);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      type: "single",
      payload: { stem: "亞伯拉罕原本住在哪座城市？", options: ["哈蘭", "吾珥", "伯特利", "示劍"] },
      answerKey: 1
    });
  });

  it("parses a true/false block accepting 對/錯", () => {
    const { questions, errors } = parseQuizImportText(`[是非] 挪亞方舟載了七種潔淨的動物各七隻。\n答案：對`);
    expect(errors).toEqual([]);
    expect(questions[0]).toMatchObject({ type: "truefalse", payload: { stem: "挪亞方舟載了七種潔淨的動物各七隻。" }, answerKey: true });
  });

  it("parses a multiple-choice block with comma-separated letters", () => {
    const { questions, errors } = parseQuizImportText(`
[多選] 以下哪些是舊約先知書？
A. 以賽亞書
B. 詩篇
C. 耶利米書
D. 箴言
答案：A,C
    `);
    expect(errors).toEqual([]);
    expect(questions[0]).toMatchObject({ type: "multiple", answerKey: [0, 2] });
  });

  it("parses a matching block where each line is one correct pair", () => {
    const { questions, errors } = parseQuizImportText(`
[配對] 請配對人物與地點
亞伯拉罕｜吾珥
摩西｜米甸
大衛｜伯利恆
    `);
    expect(errors).toEqual([]);
    const q = questions[0];
    expect(q.type).toBe("matching");
    expect(q.payload.left.map(item => item.text)).toEqual(["亞伯拉罕", "摩西", "大衛"]);
    expect(q.payload.right.map(item => item.text)).toEqual(["吾珥", "米甸", "伯利恆"]);
    // answerKey must map each left id to the right id listed on the same line
    const leftIds = q.payload.left.map(item => item.id);
    const rightIds = q.payload.right.map(item => item.id);
    leftIds.forEach((leftId, index) => expect(q.answerKey[leftId]).toBe(rightIds[index]));
  });

  const repeatedRightBlock = `
[配對] 請配對人物與身分
彼得｜加利利漁夫
馬太｜稅吏
安得烈｜ 加利利漁夫
雅各｜加利利漁夫
  `;

  it("keeps a repeated right text as separate points by default (daily quiz needs one-to-one) (#588)", () => {
    const { questions, errors } = parseQuizImportText(repeatedRightBlock);
    expect(errors).toEqual([]);
    expect(questions[0].payload.right.map(item => item.text)).toEqual(["加利利漁夫", "稅吏", "加利利漁夫", "加利利漁夫"]);
  });

  it("mergeMatchingRight folds identical right texts into one shared point (lightning quiz, #588)", () => {
    const { questions, errors } = parseQuizImportText(repeatedRightBlock, { mergeMatchingRight: true });
    expect(errors).toEqual([]);
    const { payload, answerKey } = questions[0];
    expect(payload.left.map(item => item.text)).toEqual(["彼得", "馬太", "安得烈", "雅各"]);
    expect(payload.right.map(item => item.text)).toEqual(["加利利漁夫", "稅吏"]);
    const rightIdOf = text => payload.right.find(item => item.text === text).id;
    expect(answerKey).toEqual({
      [payload.left[0].id]: rightIdOf("加利利漁夫"),
      [payload.left[1].id]: rightIdOf("稅吏"),
      [payload.left[2].id]: rightIdOf("加利利漁夫"),
      [payload.left[3].id]: rightIdOf("加利利漁夫")
    });
  });

  it("parses an ordering block where lines are already in correct order", () => {
    const { questions, errors } = parseQuizImportText(`
[排序] 請依照事件發生順序排列
創造天地
挪亞洪水
巴別塔
亞伯拉罕蒙召
    `);
    expect(errors).toEqual([]);
    const q = questions[0];
    expect(q.type).toBe("ordering");
    expect(q.payload.items.map(item => item.text)).toEqual(["創造天地", "挪亞洪水", "巴別塔", "亞伯拉罕蒙召"]);
    expect(q.answerKey).toEqual(q.payload.items.map(item => item.id));
  });

  it("parses multiple blocks in one paste, in order", () => {
    const { questions, errors } = parseQuizImportText(`
[單選] 誰帶領以色列人出埃及？
A. 摩西
B. 約書亞
答案：A

[是非] 大衛打敗了歌利亞。
答案：對
    `);
    expect(errors).toEqual([]);
    expect(questions.map(q => q.type)).toEqual(["single", "truefalse"]);
  });

  it("collects a readable error for an unknown type tag instead of throwing", () => {
    const { questions, errors } = parseQuizImportText(`[簡答] 這題不該被匯入\n答案：略`);
    expect(questions).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/不認得的題型標籤/);
  });

  it("collects an error when a single-choice block has no 答案 line", () => {
    const { questions, errors } = parseQuizImportText(`[單選] 沒有答案的題目\nA. 選項一\nB. 選項二`);
    expect(questions).toEqual([]);
    expect(errors[0].message).toMatch(/找不到答案/);
  });

  it("collects an error when the answer letter does not match any option", () => {
    const { questions, errors } = parseQuizImportText(`[單選] 題目\nA. 選項一\nB. 選項二\n答案：C`);
    expect(questions).toEqual([]);
    expect(errors[0].message).toMatch(/不在選項字母中/);
  });

  it("one malformed block does not prevent the other valid blocks from importing", () => {
    const { questions, errors } = parseQuizImportText(`
[單選] 沒有答案
A. 選項一

[是非] 大衛打敗了歌利亞。
答案：對
    `);
    expect(questions).toHaveLength(1);
    expect(questions[0].type).toBe("truefalse");
    expect(errors).toHaveLength(1);
  });

  it("returns no questions and no errors for empty input", () => {
    expect(parseQuizImportText("")).toEqual({ questions: [], errors: [] });
  });
});

// #612：雲柱選單題的匯入格式「項目｜數量」，干擾項寫 0；小測驗匯入不接受
describe("menu import (#612)", () => {
  const menuBlock = `
[選單] 挪亞方舟上，每種潔淨的動物帶幾隻？
牛｜7
羊|7
豬｜0
`;

  it("parses items and keeps only positive quantities in the answer when allowMenu is on", () => {
    const { questions, errors } = parseQuizImportText(menuBlock, { allowMenu: true });
    expect(errors).toEqual([]);
    const { type, payload, answerKey } = questions[0];
    expect(type).toBe("menu");
    expect(payload.items.map(item => item.text)).toEqual(["牛", "羊", "豬"]);
    const idOf = text => payload.items.find(item => item.text === text).id;
    expect(answerKey).toEqual({ [idOf("牛")]: 7, [idOf("羊")]: 7 });
  });

  it("is rejected for the daily quiz (allowMenu off)", () => {
    const { questions, errors } = parseQuizImportText(menuBlock);
    expect(questions).toEqual([]);
    expect(errors[0].message).toMatch(/雲柱/);
  });

  it("rejects bad quantities, too few items, and an all-zero answer", () => {
    const parse = body => parseQuizImportText(`[選單] 題目\n${body}`, { allowMenu: true }).errors[0]?.message;
    expect(parse("牛｜21\n羊｜1")).toMatch(/0～20/);
    expect(parse("牛｜1.5\n羊｜1")).toMatch(/0～20/);
    expect(parse("牛\n羊｜1")).toMatch(/項目｜數量/);
    expect(parse("牛｜1")).toMatch(/至少需要 2 個項目/);
    expect(parse("牛｜0\n羊｜0")).toMatch(/至少要有一個項目的數量大於 0/);
  });
});
