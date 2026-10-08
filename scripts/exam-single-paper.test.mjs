import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";

// #258（大測驗 C1）：單一試卷 + 草稿演練。決定見 #257。
// 核心規則：演練作答只存在於草稿卷上——發佈時清除，有正式作答就不能撤回成草稿，
// 所以統計／排行榜／匯出不需要另外排除 is_test。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = currentMigrationSql("20260926155616_exam_single_paper_rehearsal.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

// 這支 migration（#257）當時還保留舊的 mode='test' 卷；#260 刪掉 mode，#298 改成用階段
// （_exam_paper_stage：preparing／scheduled／open…）判斷，下面驗的是現在的版本。
describe("migration: rehearsal attempts live only before opening", () => {
  it("marks attempts on a preparing or scheduled paper as rehearsal (#298)", () => {
    expect(fnBody("exam_start_attempt")).toContain("_exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) IN ('preparing', 'scheduled');");
  });

  it("keeps members out until the paper is open (the 0113 guard)", () => {
    expect(fnBody("exam_start_attempt")).toContain(
      "IF pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN"
    );
    const state = fnBody("exam_get_for_attempt");
    expect(state).toContain("IF pr.status = 'draft' OR (pr.status = 'published' AND now_ts < pr.open_at) THEN");
    expect(state).toContain("open_state := CASE WHEN is_staff THEN 'open' ELSE 'not_open' END;");
    expect(state).not.toContain("_exam_can_access_test");
  });

  it("clears rehearsal attempts when publishing", () => {
    const publish = fnBody("exam_publish");
    expect(publish).toContain("DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;");
    expect(publish.indexOf("DELETE FROM public.exam_attempts")).toBeLessThan(publish.indexOf("SET status = 'published'"));
  });

  // 原本是「有真實作答就不能退回草稿」；#298 起只有「已排程、還沒開放」能取消排程，
  // 開放後就不能回頭——還沒開放代表一定沒有真實作答，保護不變。
  it("only unschedules before opening, and forces drafts through exam_publish", () => {
    const status = fnBody("exam_set_status");
    expect(status).toContain("IF p_status = 'draft' AND pr.status <> 'draft' AND stage <> 'scheduled' THEN\n    RAISE EXCEPTION 'exam_already_open';");
    expect(status).toContain("RAISE EXCEPTION 'exam_use_publish'");
  });

  it("only lets papers that are not yet open clear their attempts", () => {
    expect(fnBody("exam_reset_attempts")).toContain("_exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) NOT IN ('preparing', 'scheduled') THEN\n    RAISE EXCEPTION 'exam_reset_live_forbidden';");
  });

  it("no longer has a mode column to set (#260)", () => {
    const upsert = fnBody("exam_upsert_paper");
    expect(upsert).not.toContain("mode");
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
    // #298：撤回改成「取消排程」，只在開放前可用
    expect(db).toContain("exam_already_open:");
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

  it("offers a 試作 link before opening and can clear all trials (#302)", () => {
    expect(exam).toContain(">試作</a>");
    expect(exam).toContain('data-exam-act="reset">清除所有試作（${rehearsalCount}）</button>');
  });

  it("lets admins unschedule only before the paper opens (#298)", () => {
    const actions = exam.slice(exam.indexOf("} else if (isScheduled) {"), exam.indexOf('} else if (stage === "open") {'));
    expect(actions).toContain('data-exam-act="reopen">取消排程</button>');
    expect(exam).not.toContain("canRevert");
  });

  it("warns that scheduling clears trial attempts", () => {
    expect(exam).toContain("筆試作會一併清除。");
  });

  it("labels preparing and scheduled papers as rehearsal in the exam runner (#298)", () => {
    expect(exam).toContain('return ["preparing", "scheduled"].includes(examStage(paper));');
    expect(exam).not.toContain('this.paper.mode === "test" ? "（測試版）"');
  });
});
