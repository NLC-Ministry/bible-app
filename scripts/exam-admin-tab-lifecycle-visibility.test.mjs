import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// 分頁顯示時機依「測試版管考前、正式版管考後」的原則收斂：
//   · 統計／填答案／簡答批改／簡答指派／答案詳解：一律只在正式版出現——測試版
//     沒有真實會友作答，這些「考後」工具擺著也用不到。
//   · 統計／答案詳解另外還要求「非草稿」：草稿階段不會有作答/不急著寫詳解。
//   · 填答案／簡答批改／簡答指派：成績公布後正解跟批改都鎖死了，收起來。
//   · 複習紀錄：只看是不是正式版，不受成績公布影響（會友複習視窗是獨立算的，
//     公布當下可能還沒結束）。
const fn = () => exam.slice(exam.indexOf("const isLive = paper.mode"), exam.indexOf("const annPub ="));

describe("統計／填答案／簡答批改／簡答指派／答案詳解一律只在正式版出現", () => {
  it("showStats／showExplain／showAnswers／showGrade／showAssign 都以 isLive 開頭", () => {
    const body = fn();
    expect(body).toContain('const showStats = isLive && paper.status !== "draft";');
    expect(body).toContain('const showExplain = isLive && paper.status !== "draft";');
    expect(body).toContain("const showAnswers = isLive && !resultsPublished;");
    expect(body).toContain("const showGrade = isLive && hasShortSection && !resultsPublished;");
    expect(body).toContain("const showAssign = isLive && hasShortSection && !resultsPublished;");
  });

  it("分頁按鈕改用這幾個 show* 變數判斷要不要渲染", () => {
    expect(exam).toContain('${showStats ? `<button type="button" data-exam-sub="stats"');
    expect(exam).toContain('${showExplain ? `<button type="button" data-exam-sub="explain"');
    expect(exam).toContain('${showAnswers ? `<button type="button" data-exam-sub="answers"');
    expect(exam).toContain('${showGrade ? `<button type="button" data-exam-sub="grade"');
  });

  it("已經拿掉 canFillAnswers 這個變數——isLive 已經涵蓋它原本要判斷的事", () => {
    expect(exam).not.toContain("canFillAnswers");
  });

  it("showPractice 維持只看 isLive，不受 resultsPublished 影響", () => {
    const body = fn();
    expect(body).toContain("const showPractice = isLive;");
    expect(body).not.toContain("const showPractice = isLive && !resultsPublished;");
  });

  it("resultsPublished 的宣告在這些條件之前，確保算得出正確值", () => {
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
    expect(body).toContain('...(canEditPaper ? ["bank", "meta", "notice"] : [])');
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
