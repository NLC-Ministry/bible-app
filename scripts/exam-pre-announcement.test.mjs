import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const edge = read("supabase/functions/nlc-data/index.ts");

// 0200 加的「預告」（開考前的簡短通知，pre_announcement／pre_announcement_enabled 兩欄 +
// exam_save_pre_announcement）在 #298 退場——排程後首頁卡片就自動出現——並在 #303
// （20260929041621）連同欄位與 RPC 一起刪掉。這裡確認它真的不在了。
describe("0200 的預告已整個刪除（#298／#303）", () => {
  const dropMigration = read("supabase/migrations/20260929041621_exam_drop_legacy_columns.sql");

  it("欄位與 RPC 都刪了", () => {
    expect(dropMigration).toContain("DROP COLUMN IF EXISTS pre_announcement,");
    expect(dropMigration).toContain("DROP COLUMN IF EXISTS pre_announcement_enabled,");
    expect(() => latestFunctionDefinition("exam_save_pre_announcement")).toThrow(/dropped/);
  });

  it("首頁清單／單卡／我的測驗都不再讀預告欄位", () => {
    for (const name of ["exam_home_exams", "exam_home_banner", "_exam_member_paper_summary", "exam_my_papers"]) {
      expect(latestFunctionDefinition(name).text, name).not.toContain("pre_announcement");
    }
  });
});

describe("0200: 前端串接", () => {
  // #303：預告的欄位與 RPC 已刪（20260929041621_exam_drop_legacy_columns.sql）。
  it("#303：db.js 與 nlc-data 都不再有 exam_save_pre_announcement", () => {
    expect(db).not.toContain("saveExamPreAnnouncement");
    expect(edge).not.toContain("exam_save_pre_announcement");
  });

  // #298：預告退場——排程後首頁卡片就自動出現，不需要開考前另一則通知。
  it("#298：後台不再有「預告」編輯區，只剩一組全部選填的首頁卡片文字", () => {
    const fn = exam.slice(exam.indexOf("function renderExamNoticeForm"), exam.indexOf("// ── 試卷設定表單"));
    expect(fn).not.toContain("<legend>預告");
    expect(fn).not.toContain('id="exam-pre-enabled"');
    expect(fn).not.toContain("saveExamPreAnnouncement");
    expect(fn).toContain("<legend>首頁卡片");
    expect(fn).toContain("標題（選填，不填就用試卷標題）");
    expect(fn).toContain("說明（選填，不填就用開放時間自動產生）");
    expect(fn).toContain("host.querySelectorAll('[data-n]')");
  });
});
