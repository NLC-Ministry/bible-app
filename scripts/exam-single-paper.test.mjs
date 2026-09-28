import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #258（大測驗 C1）：單一試卷 + 草稿演練。決定見 #257。
// 核心規則：演練作答只存在於草稿卷上——發佈時清除，有正式作答就不能撤回成草稿，
// 所以統計／排行榜／匯出不需要另外排除 is_test。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260926155616_exam_single_paper_rehearsal.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

describe("migration: rehearsal attempts live only on drafts", () => {
  it("marks attempts on a draft (or a legacy test paper) as rehearsal", () => {
    expect(fnBody("exam_start_attempt")).toContain("(pr.status = 'draft' OR pr.mode = 'test')");
  });

  it("keeps members out of drafts and legacy test papers (the 0113 guard)", () => {
    expect(fnBody("exam_start_attempt")).toContain(
      "IF pr.mode = 'test' OR pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN"
    );
    const state = fnBody("exam_get_for_attempt");
    expect(state).toContain("open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;   -- 管理員演練");
    expect(state).not.toContain("_exam_can_access_test");
  });

  it("clears rehearsal attempts when publishing", () => {
    const publish = fnBody("exam_publish");
    expect(publish).toContain("DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;");
    expect(publish.indexOf("DELETE FROM public.exam_attempts")).toBeLessThan(publish.indexOf("SET status = 'published'"));
  });

  it("refuses to revert a paper with real attempts, and forces drafts through exam_publish", () => {
    const status = fnBody("exam_set_status");
    expect(status).toContain("RAISE EXCEPTION 'exam_revert_has_attempts'");
    expect(status).toContain("WHERE paper_id = pr.id AND NOT is_test");
    expect(status).toContain("RAISE EXCEPTION 'exam_use_publish'");
  });

  it("only lets drafts (or legacy test papers) clear their attempts", () => {
    expect(fnBody("exam_reset_attempts")).toContain("IF pr.status <> 'draft' AND pr.mode <> 'test' THEN RAISE EXCEPTION 'exam_reset_live_forbidden'");
  });

  it("creates every new paper as live and never changes mode", () => {
    const upsert = fnBody("exam_upsert_paper");
    expect(upsert).toContain("'live',                                   -- 不再有測試版");
    expect(upsert).not.toMatch(/mode = COALESCE/);
  });

  it("takes client access away from the removed features, keeping service_role", () => {
    for (const sig of [
      "exam_push_to_live(uuid, uuid)", "exam_set_mode(uuid, text, uuid)", "exam_add_tester(uuid, text, uuid)",
      "exam_remove_tester(uuid, uuid, uuid)", "exam_get_paper_testers(uuid, uuid)", "_exam_can_access_test(uuid, uuid)"
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated;`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${sig} TO service_role;`);
    }
  });

  it("revokes anon on every redefined function (0214 rule)", () => {
    for (const sig of [
      "exam_start_attempt(uuid, text, uuid, uuid)", "exam_get_for_attempt(uuid, uuid, boolean, text)",
      "exam_publish(uuid, uuid)", "exam_set_status(uuid, text, uuid)", "exam_reset_attempts(uuid, uuid)",
      "exam_upsert_paper(jsonb, uuid)"
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`);
    }
  });
});

describe("clients: push-to-live and tester list are gone", () => {
  it("nlc-data no longer allows the removed RPCs", () => {
    for (const fn of ["exam_set_mode", "exam_push_to_live", "exam_add_tester", "exam_remove_tester", "exam_get_paper_testers"]) {
      expect(nlcData).not.toContain(`"${fn}"`);
    }
  });

  it("db.js drops the methods and explains the new errors", () => {
    expect(db).not.toMatch(/pushExamToLive\(|ExamTester\(|getExamPaperTesters\(/);
    expect(db).toContain("exam_use_publish:");
    expect(db).toContain("exam_revert_has_attempts:");
  });
});

describe("admin UI: one paper, edit and rehearse while draft", () => {
  it("has no test/live version switch, push, or tester list", () => {
    for (const gone of ["ver-test", "ver-live", 'data-exam-act="push"', "exam-tester", "testOf", "liveOf", "推上正式版", "同步到正式版"]) {
      expect(exam).not.toContain(gone);
    }
  });

  it("lists every paper: legacy test papers are gone after C2/C3 (#259/#260)", () => {
    expect(exam).toContain("const examList = papers;");
    expect(exam).not.toMatch(/.modes*[!=]==s*"test"/);
  });

  it("offers a rehearsal link while draft and clears rehearsal attempts from the more menu", () => {
    expect(exam).toContain(">演練作答</a>");
    expect(exam).toContain('data-exam-act="reset">清除演練作答（${rehearsalCount}）</button>');
  });

  it("lets admins unschedule only before the paper opens (#298)", () => {
    const actions = exam.slice(exam.indexOf("} else if (isScheduled) {"), exam.indexOf('} else if (stage === "open") {'));
    expect(actions).toContain('data-exam-act="reopen">取消排程</button>');
    expect(exam).not.toContain("canRevert");
  });

  it("warns that publishing clears rehearsal attempts", () => {
    expect(exam).toContain("筆演練作答會一併清除。");
  });

  it("labels preparing and scheduled papers as rehearsal in the exam runner (#298)", () => {
    expect(exam).toContain('return ["preparing", "scheduled"].includes(examStageOf(paper));');
    expect(exam).not.toContain('this.paper.mode === "test" ? "（測試版）"');
  });
});
