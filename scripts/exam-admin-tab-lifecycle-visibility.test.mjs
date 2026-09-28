import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// 單一試卷（#257／#258），五個階段（#297／#298）：分頁顯示時機依階段決定：
//   · 題庫編輯／試卷設定：準備中、已排程（伺服器端 exam_upsert_paper／exam_upsert_question 同樣限制）。
//   · 首頁卡片：測驗結束前都能改（伺服器端 exam_save_announcement 擋 closed）。
//   · 填答案／簡答批改／簡答指派：成績公布前都開放，準備中也有——管理員要能演練批改。
//   · 統計：開放作答後；準備中／已排程有演練作答時也開放，讓管理員演練完整流程。
//   · 答案詳解、複習紀錄：開放作答後（能改題目時詳解直接在題目卡片裡改）。
const fn = () => exam.slice(exam.indexOf("const stage = examStageOf(paper);"), exam.indexOf("const autoScoreOn ="));

describe("分頁顯示規則依試卷階段，不再區分測試版／正式版", () => {
  it("編輯類分頁：準備中、已排程都能改", () => {
    const body = fn();
    expect(body).toContain('const isDraft = stage === "preparing";');
    expect(body).toContain('const isScheduled = stage === "scheduled";');
    expect(body).toContain("const canEditPaper = isDraft || isScheduled;");
    expect(body).toContain('const showNotice = paper.status !== "closed";');
  });

  it("草稿也能填答案、批改、指派（演練）；成績公布後收起來", () => {
    const body = fn();
    expect(body).toContain("const showAnswers = !resultsPublished;");
    expect(body).toContain("const showGrade = hasShortSection && !resultsPublished;");
    expect(body).toContain("const showAssign = hasShortSection && !resultsPublished;");
  });

  it("統計：開放作答後，或準備中／已排程已經有演練作答；答案詳解、複習紀錄：開放作答後", () => {
    const body = fn();
    expect(body).toContain("const showStats = !canEditPaper || attemptCount > 0;");
    expect(body).toContain("const showExplain = !canEditPaper;");
    expect(body).toContain("const showPractice = !canEditPaper;");
  });

  it("不再用 isLive／isTest 判斷任何分頁", () => {
    expect(exam).not.toMatch(/\bisLive\b/);
    expect(exam).not.toMatch(/\bisTest\b/);
  });

  it("分頁按鈕改用這幾個 show* 變數判斷要不要渲染", () => {
    expect(exam).toContain('${showStats ? `<button type="button" data-exam-sub="stats"');
    expect(exam).toContain('${showExplain ? `<button type="button" data-exam-sub="explain"');
    expect(exam).toContain('${showAnswers ? `<button type="button" data-exam-sub="answers"');
    expect(exam).toContain('${showGrade ? `<button type="button" data-exam-sub="grade"');
    expect(exam).toContain('${showNotice ? `<button type="button" data-exam-sub="notice"');
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
    expect(body).toContain('...(canEditPaper ? ["bank", "meta"] : [])');
    expect(body).toContain('...(showNotice ? ["notice"] : [])');
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
    expect(exam).not.toContain("canFillAnswers");
  });

  it("首頁卡片分頁在開放作答後也能開（不會被「題目已鎖定」的提示擋住）", () => {
    const sub = exam.slice(exam.indexOf("const renderSub = async () => {"), exam.indexOf('body.querySelectorAll("[data-exam-sub]")'));
    expect(sub.indexOf('examAdminSubview === "notice" && showNotice')).toBeGreaterThan(-1);
    expect(sub.indexOf('examAdminSubview === "notice" && showNotice')).toBeLessThan(sub.indexOf("else if (!canEditPaper)"));
  });
});
