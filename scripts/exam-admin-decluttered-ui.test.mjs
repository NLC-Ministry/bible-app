import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");
const css = read("index.css");

// 精簡大測驗後台畫面：建立試卷先問標題、發佈按鈕延後到準備就緒才出現（改用
// 準備進度清單引導取代整段說明文字）、不常用的切換動作收進「更多」、政策性
// 文字集中到「說明」分頁、儲存按鈕有三態回饋。

describe("建立新試卷：先跳出標題輸入，不再直接用預設標題「速讀測驗」建立", () => {
  it("openExamCreateTitleModal 是一個獨立的 modal 開啟函式，接受標題後才呼叫 onConfirm", () => {
    expect(exam).toContain("function openExamCreateTitleModal(onConfirm)");
    expect(exam).toContain('overlay.className = "tts-guide-modal-overlay exam-admin-modal";');
    expect(exam).toContain('id="exam-create-title"');
  });

  it("createPaper 改成先開 modal，成功才呼叫 upsertExamPaper（標題來自使用者輸入）", () => {
    const fn = exam.slice(exam.indexOf("const createPaper = ()"), exam.indexOf("const examList ="));
    expect(fn).toContain("openExamCreateTitleModal(async (title) => {");
    expect(fn).toContain("db.upsertExamPaper({ title, section_targets: SECTION_TARGET_DEFAULT })");
    // 單一試卷（#258）：不再建立測試版，mode 交給伺服器端（一律 live）
    expect(fn).not.toContain('mode: "test"');
    expect(fn).not.toContain('title: "速讀測驗"');
  });

  it("空白試卷清單的 #exam-create-paper 按鈕不再重複綁定兩次（原本 wirePicker + 額外一次）", () => {
    const fn = exam.slice(exam.indexOf("if (!shownPaper) {"), exam.indexOf("const stage = examStageOf(paper);"));
    expect(fn).toContain("wirePicker();");
    expect(fn).not.toContain('.exam-admin__paper #exam-create-paper');
  });
});

describe("準備進度清單：草稿階段引導完成必要項目，取代原本一整段說明文字", () => {
  it("examReadinessChecklist 對齊 exam_publish 的伺服器端硬性條件", () => {
    const fn = exam.slice(exam.indexOf("function examReadinessChecklist"), exam.indexOf("function examChecklistHtml"));
    expect(fn).toContain('{ label: "已選擇題型並設定題數", done: activeSections.length > 0, required: true }');
    expect(fn).toContain("countsMatch");
    // #339：開放時間改在「排程」視窗裡選，不再是清單項目（見 exam-rehearsal-ignores-window.test.mjs）
    expect(fn).not.toContain("windowValid");
    expect(fn).not.toContain("paper.mode");
    // #298：首頁卡片文字沒填會自動產生、排程後自動出現，清單只列出題的事
    expect(fn).not.toContain("公告");
    expect(fn).not.toContain("announcement_published");
  });

  it("只有必要項（required）會擋住 requiredDone，選填項不影響", () => {
    const fn = exam.slice(exam.indexOf("function examReadinessChecklist"), exam.indexOf("function examChecklistHtml"));
    expect(fn).toContain("const requiredItems = items.filter((i) => i.required);");
    expect(fn).toContain("requiredDone: requiredItems.every((i) => i.done)");
  });

  it("準備中的「排程」按鈕改用 checklist.requiredDone 判斷要不要出現；「同步到正式版」已移除", () => {
    expect(exam).toContain("if (isDraft && checklist.requiredDone) {");
    expect(exam).not.toContain('data-exam-act="push"');
    // 舊的「isTest || annPub」文字判斷已經拿掉，改成 checklist 統一處理
    expect(exam).not.toContain("if (isTest || annPub) {");
  });

  it("checklist 就緒後主畫面不再顯示清單（showChecklist 只在 draft 且未就緒時為真）", () => {
    expect(exam).toContain("const showChecklist = isDraft && !checklist.requiredDone;");
  });

  it("examChecklistHtml 渲染一條進度條 + 逐項打勾清單", () => {
    const fn = exam.slice(exam.indexOf("function examChecklistHtml"), exam.indexOf("// ── 儲存按鈕三態回饋"));
    expect(fn).toContain("exam-admin__checklist-progress-fill");
    expect(fn).toContain('i.done ? "✓" : i.required ? "○" : "·"');
  });

  it("index.css 有對應的進度條與清單樣式", () => {
    expect(css).toContain(".exam-admin__checklist-progress-fill");
    expect(css).toContain(".exam-admin__checklist-item.is-done");
  });
});

describe("主畫面只留當下真正要做的事：一顆主按鈕＋直接列出的次要工具，沒有「⋯ 更多」（#300）", () => {
  it("答案詳解／複習開關放在「作答規則」列，清除所有試作放在次要工具（自動評分開關已拿掉，#299）", () => {
    expect(exam).not.toContain('data-exam-act="autoscore"');
    expect(exam).toContain('data-exam-act="practice-toggle">${practiceEnabled ? "關閉複習" : "開啟複習"}</button>');
    expect(exam).toContain('data-exam-act="explain-toggle">${explanationOn ? "隱藏答案詳解" : "顯示答案詳解"}</button>');
    // #298：沒有「發佈預告文」了；「取消排程」是已排程時的主要動作
    expect(exam).not.toContain('data-exam-act="announce"');
    expect(exam).not.toContain("撤回成草稿");
    expect(exam).toContain('tools.push(`<button type="button" class="secondary-btn" data-exam-act="reset">');
  });

  it("主按鈕：排程／取消排程／提前結束／公布成績；試作、正式作答是次要工具（#302 起試作取代演練作答與預覽試卷）", () => {
    expect(exam).toContain('mainAction = `<button type="button" class="primary-btn" data-exam-act="publish">排程</button>${examInfoIcon(');
    expect(exam).toContain(`mainAction = '<button type="button" class="secondary-btn" data-exam-act="reopen">取消排程</button>';`);
    expect(exam).toContain(`mainAction = '<button type="button" class="secondary-btn" data-exam-act="close">提前結束</button>';`);
    expect(exam).toContain('mainAction = `<button type="button" class="primary-btn" data-exam-act="publish-results">公布成績</button>${examInfoIcon(');
    expect(exam).toContain('tools.push(`<a class="secondary-btn" href="${examUrl}" target="_blank" rel="noopener">試作</a>');
  });

  it("模板：主按鈕一列、次要工具一列、作答規則一列；沒有收合的 details", () => {
    expect(exam).toContain('${mainAction ? `<div class="exam-admin__actions">${mainAction}</div>` : ""}');
    expect(exam).toContain('<div class="exam-admin__actions exam-admin__actions--tools">${tools.join("")}</div>');
    expect(exam).toContain('<p class="exam-admin__rules">${rules.join("")}</p>');
    expect(exam).not.toContain('<details class="exam-admin__more">');
  });

  it("動作按鈕用同一支 handleAct 處理，標頭與「設定」分頁（作答規則）各自綁一次", () => {
    expect(exam).toContain('const wireActs = (scope) => scope.querySelectorAll("[data-exam-act]").forEach((b) => b.addEventListener("click", () => handleAct(b)));');
    expect(exam).toContain('wireActs(body.querySelector(".exam-admin__paper"));');
    expect(exam).toContain("wireActs(sub);");
  });
});

describe("說明改成小圖示點擊彈出：不再另外開分頁，需要才點開", () => {
  it("獨立的「說明」分頁已經整個拿掉", () => {
    expect(exam).not.toContain('data-exam-sub="info"');
    expect(exam).not.toContain("function renderExamInfoTab");
    expect(exam).not.toContain('examAdminSubview === "info"');
  });

  it("examInfoIcon 用 Lucide 的 info 圖示（有 fallback），文字放在 data-info-text 屬性上", () => {
    const fn = exam.slice(exam.indexOf("function examInfoIcon"), exam.indexOf("let _examInfoPopoverEl"));
    expect(fn).toContain('typeof renderIcon === "function" ? renderIcon("info"');
    expect(fn).toContain('data-info-text="${esc(text)}"');
  });

  it("點擊用事件代理在 body 綁一次，重繪不用重綁；再點一次同一顆圖示會關閉，點別的地方也會關閉", () => {
    expect(exam).toContain('const btn = e.target.closest("[data-info-text]");');
    expect(exam).toContain("if (btn) { e.stopPropagation(); _toggleExamInfoPopover(btn); }");
    expect(exam).toContain("if (_examInfoPopoverEl && _examInfoPopoverEl._anchor === anchorBtn) { _closeExamInfoPopover(); return; }");
    expect(exam).toContain('document.addEventListener("click", _onDocClickCloseExamInfoPopover, true);');
    expect(exam).toContain('if (e.key === "Escape") _closeExamInfoPopover();');
  });

  it("原本說明分頁的幾個主題，改成放在對應位置的圖示旁邊：試作、首頁卡片、答案詳解、複習、清除試作、公布成績", () => {
    expect(exam).not.toContain('examInfoIcon("測試版與正式版是兩份獨立的卷。');
    expect(exam).toContain('>試作</a>${examInfoIcon(');
    expect(exam).toContain('<legend>首頁卡片${examInfoIcon(');
    expect(exam).toContain('data-exam-act="explain-toggle">${explanationOn ? "隱藏答案詳解" : "顯示答案詳解"}</button>${examInfoIcon(');
    expect(exam).toContain('data-exam-act="practice-toggle">${practiceEnabled ? "關閉複習" : "開啟複習"}</button>${examInfoIcon(');
    expect(exam).toContain('data-exam-act="reset">清除所有試作（${rehearsalCount}）</button>${examInfoIcon(');
    expect(exam).toContain('data-exam-act="publish-results">公布成績</button>${examInfoIcon(');
  });

  it("index.css 定義了圖示按鈕與彈出框的樣式", () => {
    expect(css).toContain(".exam-admin__info-icon {");
    expect(css).toContain(".exam-admin__info-popover {");
    expect(css).not.toContain(".exam-admin__info-item");
  });
});

describe("儲存按鈕三態回饋：有改動待存／儲存中／剛存好", () => {
  it("共用的 wireSaveButton helper 支援固定欄位清單跟事件代理兩種監聽模式", () => {
    const fn = exam.slice(exam.indexOf("function wireSaveButton"), exam.indexOf("// ── 建立新試卷"));
    expect(fn).toContain('typeof watchTarget.forEach === "function"');
    expect(fn).toContain('watchTarget.addEventListener("input", markDirty);');
    expect(fn).toContain('setState("saving")');
    expect(fn).toContain('setState("saved")');
    expect(fn).toContain("onDone?.()");
  });

  it("套用在試卷設定／公告設定／題目卡片／答案詳解四個存檔按鈕，公告設定只監聽自己的 data-n 欄位（不會被試卷設定的改動誤判待存）", () => {
    expect(exam).toContain('wireSaveButton(\n    host.querySelector("#exam-meta-save"),\n    host.querySelectorAll(\'[data-f], .exam-admin__sec-row input, #exam-meta-linked-plan\'),');
    expect(exam).toContain('wireSaveButton(\n    host.querySelector("#exam-notice-save"),\n    host.querySelectorAll(\'[data-n]\'),');
    expect(exam).toContain('wireSaveButton(card.querySelector("[data-q-save]"), card, async () => {');
    // 開放作答後的題目卡片（#301）：答案詳解的存檔鈕只監聽自己的文字框，不會被旁邊的正解欄位誤判待存
    expect(exam).toContain('wireSaveButton(card.querySelector("[data-explain-save]"), [text], () =>');
  });

  it("index.css 定義了 is-dirty／is-saving／is-saved 三種按鈕樣式", () => {
    expect(css).toContain(".exam-admin button.is-dirty");
    expect(css).toContain(".exam-admin button.is-saving");
    expect(css).toContain(".exam-admin button.is-saved");
  });
});
