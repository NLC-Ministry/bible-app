import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";

// #258 後續：管理員在草稿卷上演練作答後，只要預告文已發佈，首頁卡片就顯示
// 「已完成作答」。演練作答（is_test）不能出現在會友端的個人紀錄；作答頁的結果
// 畫面改成標明「演練作答」，並提供只清自己演練的「重新演練」。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = currentMigrationSql("20260927082256_exam_rehearsal_not_in_member_views.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const fnBlock = (name, quoted = true) => {
  const head = quoted ? `CREATE OR REPLACE FUNCTION "public"."${name}"(` : `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = migration.indexOf(head);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("GRANT EXECUTE", start);
  return migration.slice(start, migration.indexOf("\n", end) + 1);
};

describe("會友端的個人紀錄不含演練作答", () => {
  it("_exam_member_paper_summary 找自己的正式／複習作答時排除 is_test", () => {
    const block = fnBlock("_exam_member_paper_summary");
    expect(block).toContain("attempt_kind='official' AND NOT is_test;");
    expect(block).toContain("attempt_kind='practice' AND NOT is_test;");
    expect(block).toContain('FROM PUBLIC, anon;');
    expect(block).toContain("TO authenticated, service_role;");
  });

  it("exam_my_papers 排除 is_test", () => {
    const block = fnBlock("exam_my_papers");
    expect(block).toContain("oa.attempt_kind = 'official' AND NOT oa.is_test");
    expect(block).toContain("TO authenticated, service_role;");
  });
});

describe("exam_reset_my_rehearsal", () => {
  const block = fnBlock("exam_reset_my_rehearsal", false);

  // 「只限草稿卷」在 #298 放寬成「開放作答前（準備中、已排程）」，錯誤碼沿用 exam_rehearsal_draft_only
  it("只給 admin/pastor、只限開放作答前的卷、只刪自己的演練作答", () => {
    expect(block).toContain("resolve_quiz_actor(p_actor_id)");
    expect(block).toContain("NOT IN ('admin', 'pastor')");
    expect(block).toMatch(/_exam_paper_stage\(pr\.status, pr\.open_at, pr\.results_published_at\) NOT IN \('preparing', 'scheduled'\) THEN\s+RAISE EXCEPTION 'exam_rehearsal_draft_only';/);
    expect(block).toContain("WHERE paper_id = pr.id AND user_id = actor_id AND is_test;");
  });

  it("權限：先全部收回，再只給 authenticated／service_role", () => {
    expect(block).toContain("REVOKE ALL ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) FROM PUBLIC, anon, authenticated;");
    expect(block).toContain("GRANT EXECUTE ON FUNCTION public.exam_reset_my_rehearsal(uuid, uuid) TO authenticated, service_role;");
  });

  it("nlc-data 兩份 allowlist 都有、db.js 有對應方法與錯誤訊息", () => {
    expect(nlcData.split('"exam_reset_my_rehearsal",').length - 1).toBe(2);
    expect(db).toContain('this._callExamRpc("exam_reset_my_rehearsal", { p_paper_id: paperId })');
    expect(db).toContain("exam_rehearsal_draft_only:");
  });
});

describe("作答結果畫面", () => {
  it("試作標明不列入成績，並有「重新試作」按鈕（複習不算試作；#302 起「演練」改稱「試作」）", () => {
    expect(exam).toContain("const isRehearsal = !isPractice && isRehearsalPaper(this.paper);");
    expect(exam).toContain("這是<strong>試作</strong>");
    expect(exam).toContain('id="exam-result-rehearse-again"');
    expect(exam).toContain("db.resetMyExamRehearsal(this.paper.id)");
  });
});
