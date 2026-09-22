import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// 分頁顯示時機依生命週期收斂：
//   · 統計／答案詳解：草稿階段不會有作答/急著寫詳解，發佈後才出現。
//   · 填答案／簡答批改／簡答指派：成績公布後正解跟批改都鎖死了，收起來。
//   · 複習紀錄：不受成績公布影響（會友複習視窗是獨立算的，公布當下可能還沒結束）。
const fn = () => exam.slice(exam.indexOf("const isLive = paper.mode"), exam.indexOf("const annPub ="));

describe("統計／答案詳解只在發佈後（非草稿）才顯示", () => {
  it("showStats／showExplain 都是 paper.status !== \"draft\"", () => {
    const body = fn();
    expect(body).toContain('const showStats = paper.status !== "draft";');
    expect(body).toContain('const showExplain = paper.status !== "draft";');
  });

  it("分頁按鈕改用 showStats／showExplain 判斷要不要渲染", () => {
    expect(exam).toContain('${showStats ? `<button type="button" data-exam-sub="stats"');
    expect(exam).toContain('${showExplain ? `<button type="button" data-exam-sub="explain"');
  });
});

describe("成績公布後，填答案／簡答批改／簡答指派不再顯示；複習紀錄不受影響", () => {
  it("showAnswers／showGrade／showAssign 都額外加了 !resultsPublished", () => {
    const body = fn();
    expect(body).toContain("const showAnswers = canFillAnswers && !resultsPublished;");
    expect(body).toContain("const showGrade = hasShortSection && !resultsPublished;");
    expect(body).toContain("const showAssign = hasShortSection && !resultsPublished;");
  });

  it("showPractice 維持只看 isLive，不受 resultsPublished 影響", () => {
    const body = fn();
    expect(body).toContain("const showPractice = isLive;");
    expect(body).not.toContain("const showPractice = isLive && !resultsPublished;");
  });

  it("resultsPublished 的宣告移到這些條件之前，確保算得出正確值", () => {
    const body = fn();
    const idxResultsPublished = body.indexOf("const resultsPublished =");
    const idxShowAnswers = body.indexOf("const showAnswers =");
    expect(idxResultsPublished).toBeGreaterThan(-1);
    expect(idxShowAnswers).toBeGreaterThan(idxResultsPublished);
  });
});

describe("目前選中的分頁一旦不再顯示，自動跳到第一個還看得到的分頁，不會卡在空白畫面", () => {
  it("availableSubviews 涵蓋所有分頁，且用它來判斷要不要重新導向", () => {
    const body = fn();
    expect(body).toContain('...(canEditPaper ? ["bank", "meta"] : [])');
    expect(body).toContain('...(showAnswers ? ["answers"] : [])');
    expect(body).toContain('...(showGrade ? ["grade"] : [])');
    expect(body).toContain('...(showAssign ? ["assign"] : [])');
    expect(body).toContain('...(showPractice ? ["practice"] : [])');
    expect(body).toContain('...(showStats ? ["stats"] : [])');
    expect(body).toContain('...(showExplain ? ["explain"] : [])');
    expect(body).toContain('if (!availableSubviews.includes(examAdminSubview)) examAdminSubview = availableSubviews[0] || "bank";');
  });

  it("舊的逐條 if 導向邏輯已經拿掉，統一由 availableSubviews 處理", () => {
    expect(exam).not.toContain('if (examAdminSubview === "grade" && !hasShortSection) examAdminSubview = "bank";');
    expect(exam).not.toContain('if (examAdminSubview === "practice" && !isLive) examAdminSubview = "bank";');
    expect(exam).not.toContain('if (examAdminSubview === "answers" && !canFillAnswers) examAdminSubview = "bank";');
  });
});
