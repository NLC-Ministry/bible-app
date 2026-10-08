import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");

// 0199 當時測試版／正式版是兩份試卷，公告內容由 exam_push_to_live 每次同步覆蓋。
// #258 改成單一試卷、#260（20260927051721）把 exam_push_to_live 連同 mode 一起刪掉，
// 公告內容就在唯一那份試卷上編輯。
describe("exam_push_to_live 已隨單一試卷刪除（#258／#260）", () => {
  it("沒有「同步到正式版」這一步了", () => {
    expect(() => latestFunctionDefinition("exam_push_to_live")).toThrow(/dropped in 20260927051721/);
  });
});

describe("0199/0200: 公告內容編輯是測試版限定的獨立「公告」分頁，正式版不能自己編輯", () => {
  // 這段架構前後改了兩次：0199 先把公告內容編輯併進測試版的「試卷設定」分頁；
  // 使用者後來反饋不要跟試卷設定混在一起，改回獨立分頁——但維持「只有測試版
  // 能編輯，正式版靠同步」這個 0199 就定下的規則沒變。
  it("renderExamNoticeForm 是獨立函式，讀寫 paper.announcement，不在 renderExamMetaForm 裡面", () => {
    const metaFn = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("// ── 題目已鎖定時"));
    expect(metaFn).not.toContain('data-n="headline"');
    expect(metaFn).not.toContain("db.saveExamAnnouncement");

    const noticeFn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("function renderExamMetaForm"));
    expect(noticeFn).toContain('data-n="headline"');
    expect(noticeFn).toContain('data-n="body"');
    expect(noticeFn).toContain('data-n="ctaLabel"');
    expect(noticeFn).toContain("db.saveExamAnnouncement(p.id, {");
  });

  it("公告內容關閉後鎖定，跟試卷設定其他欄位的鎖定時機一致（status='closed'）", () => {
    const noticeFn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("function renderExamMetaForm"));
    expect(noticeFn).toContain("const annLocked = p.status === \"closed\";");
  });

  it("首頁卡片文字放在「設定」分頁，任何階段都看得到；結束後唯讀（伺服器端 exam_save_announcement 同樣擋 closed，#301）", () => {
    expect(exam).toContain('renderExamNoticeForm(sub.querySelector("[data-settings-card]"), paper, rerender);');
    expect(exam).not.toContain('data-exam-sub="notice"');
  });

  it("#298：沒有「發佈預告文」/「撤下預告文」了——排程後首頁卡片自動出現", () => {
    expect(exam).not.toContain('data-exam-act="announce"');
    expect(exam).not.toContain('data-exam-act="unannounce"');
    expect(exam).not.toContain("publishExamAnnouncement");
  });
});
