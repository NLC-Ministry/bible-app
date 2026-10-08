import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");
const home = read("js/modules/home.js");

// 0198 當時測試版／正式版是兩份試卷，測試版也能發佈預告文先在首頁預覽，外流靠
// (mode='live' OR is_staff) 把關。之後：#260 刪掉 mode（單一試卷）、#303 刪掉
// exam_publish_announcement（排程後首頁卡片自動出現）。現在的把關是「草稿卷不進會友清單」。
describe("0198 之後：草稿卷不會出現在會友的首頁或「我的測驗」", () => {
  it("exam_publish_announcement 已刪（#303）", () => {
    expect(() => latestFunctionDefinition("exam_publish_announcement")).toThrow(/dropped/);
  });

  it("首頁清單／單卡／我的測驗都只列 published、closed 的卷", () => {
    for (const name of ["exam_home_exams", "exam_home_banner", "exam_my_papers"]) {
      const fn = latestFunctionDefinition(name).text;
      expect(fn, name).toContain("WHERE pr.status IN ('published', 'closed')");
      expect(fn, name).not.toContain("pr.mode");
    }
  });
});

describe("0198: 大測驗 admin UI 兩版都顯示「預告文」分頁，文案依 mode 區分受眾", () => {
  it("hasNotice 開關拿掉了：首頁卡片分頁一律依 showNotice（測驗結束前）顯示", () => {
    expect(exam).not.toContain("hasNotice");
    expect(exam).not.toContain('const hasNotice = isLive;');
  });

  it("#298：排程的 confirm／toast 講清楚受眾——排程後全體會友首頁立刻出現卡片", () => {
    expect(exam).toContain("排程後，會友首頁會立刻出現這份測驗的卡片");
    expect(exam).toContain('"已排程，會友首頁已出現這份測驗的卡片"');
    expect(exam).not.toContain("將把這份預告文發佈到全體會友的首頁");
    expect(exam).not.toContain("只有你自己（管理員）看得到，用來預覽效果");
  });

  it("公告內容編輯是測試版限定的獨立分頁（renderExamNoticeForm），不跟試卷設定混在一起", () => {
    // 0199 先把公告內容編輯併進測試版的試卷設定分頁；後來使用者反饋不要跟試卷
    // 設定混在一起，改回獨立分頁——但只給測試版（跟 0199 的「正式版不能自己
    // 編內容」決定一致），詳見 exam-announcement-test-owned.test.mjs。
    expect(exam).toContain("function renderExamNoticeForm(host, paper, rerender)");
  });
});

describe("C3（#260）：沒有測試版了，首頁卡片不再有「測試版」badge", () => {
  it("home.js 不再依 d.mode 顯示測試版徽章", () => {
    expect(home).not.toContain('d.mode === "test"');
  });
});
