import { describe, expect, it } from "vitest";
import { applyExamMatchClick, examMatchingCardError } from "./exam-matching.mjs";

// #611：大測驗連連看多對一——右欄比左欄少時，一個右邊點可以接多條線
describe("applyExamMatchClick", () => {
  it("一對一：右邊點被第二個左邊項連上時，拆掉原本那條線", () => {
    const cur = { L1: "R1" };
    const pending = applyExamMatchClick(cur, "L2", "R", "R1", false);
    expect(pending).toBeNull();
    expect(cur).toEqual({ L2: "R1" });
  });

  it("一對一：單獨點右邊點會拆掉它的線（行為不變）", () => {
    const cur = { L1: "R1" };
    applyExamMatchClick(cur, null, "R", "R1", false);
    expect(cur).toEqual({});
  });

  it("多對一：右邊點可以接多條線，不拆掉別人的線", () => {
    const cur = { L1: "R1" };
    applyExamMatchClick(cur, "L2", "R", "R1", true);
    expect(cur).toEqual({ L1: "R1", L2: "R1" });
  });

  it("多對一：單獨點右邊點不做任何事", () => {
    const cur = { L1: "R1", L2: "R1" };
    const pending = applyExamMatchClick(cur, null, "R", "R1", true);
    expect(pending).toBeNull();
    expect(cur).toEqual({ L1: "R1", L2: "R1" });
  });

  it("多對一：點左邊再點它已連的右邊點就取消那一條", () => {
    const cur = { L1: "R1", L2: "R1" };
    applyExamMatchClick(cur, "L2", "R", "R1", true);
    expect(cur).toEqual({ L1: "R1" });
  });

  it("點左邊項目切換待連狀態", () => {
    const cur = {};
    expect(applyExamMatchClick(cur, null, "L", "L1", true)).toBe("L1");
    expect(applyExamMatchClick(cur, "L1", "L", "L1", true)).toBeNull();
    expect(applyExamMatchClick(cur, "L1", "L", "L2", true)).toBe("L2");
  });
});

describe("examMatchingCardError", () => {
  const left = [{ id: "L1", text: "彼得" }, { id: "L2", text: "安得烈" }, { id: "L3", text: "馬太" }];

  it("右欄比左欄少、多個左邊對同一個右邊可以存", () => {
    const right = [{ id: "R1", text: "加利利漁夫" }, { id: "R2", text: "稅吏" }];
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R1", L3: "R2" })).toBeNull();
  });

  it("一對一照舊可以存", () => {
    const right = [{ id: "R1", text: "a" }, { id: "R2", text: "b" }, { id: "R3", text: "c" }];
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R2", L3: "R3" })).toBeNull();
  });

  it("右欄比左欄多不能存", () => {
    const right = [1, 2, 3, 4].map((n) => ({ id: `R${n}`, text: String(n) }));
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R2", L3: "R3" })).toMatch(/右欄/);
  });

  it("正解組數不等於左欄項數不能存", () => {
    const right = [{ id: "R1", text: "a" }, { id: "R2", text: "b" }];
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R1" })).toMatch(/正解組數/);
  });

  it("正解的右邊 id 不存在不能存", () => {
    const right = [{ id: "R1", text: "a" }, { id: "R2", text: "b" }];
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R1", L3: "R9" })).toMatch(/R9/);
  });

  it("正解的左邊 id 不存在不能存", () => {
    const right = [{ id: "R1", text: "a" }, { id: "R2", text: "b" }];
    expect(examMatchingCardError(left, right, { L1: "R1", L2: "R1", L9: "R2" })).toMatch(/L9/);
  });
});
