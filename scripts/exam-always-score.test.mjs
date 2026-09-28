import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #299（大測驗 R2，屬於 #297）：拿掉自動評分開關、批改中改正解自動重算、
// 公布成績前說清楚還差什麼。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260928033758_exam_always_score_and_recompute.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

describe("migration: closing always scores", () => {
  it("_exam_close_paper and _exam_sweep_expired no longer read auto_score_enabled", () => {
    for (const name of ["_exam_close_paper", "_exam_sweep_expired"]) {
      expect(fnBody(name), name).not.toContain("auto_score_enabled");
      expect(fnBody(name), name).not.toContain("auto_on");
    }
  });

  it("closing scores every submitted official attempt, keys complete or not", () => {
    const close = fnBody("_exam_close_paper");
    expect(close).toContain("WHERE paper_id=pr.id AND attempt_kind='official' AND status IN('submitted','graded') LOOP");
    expect(close).toContain("PERFORM public._exam_score_attempt(a.id);");
    expect(close).not.toContain("IF auto_on AND keys_ok THEN");
  });

  it("internal helpers are service_role-only", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._exam_close_paper(uuid, text, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._exam_sweep_expired(uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});

describe("migration: correcting an answer key while grading rescores automatically", () => {
  it("rescored in the same transaction, only after closing and before results are published", () => {
    const key = fnBody("exam_set_answer_key");
    expect(key).toContain("SELECT * INTO pr FROM public.exam_papers WHERE id = q.paper_id FOR UPDATE;");
    expect(key).toContain("IF pr.results_published_at IS NOT NULL THEN RAISE EXCEPTION 'exam_results_locked'; END IF;");
    expect(key).toContain("IF pr.status = 'closed' THEN");
    expect(key).toContain("WHERE paper_id = pr.id AND status IN ('submitted', 'graded') LOOP");
    expect(key).toContain("'recomputed', n");
  });
});

describe("migration: publishing results says what is missing", () => {
  it("lists questions without an answer key", () => {
    const pub = fnBody("exam_publish_results");
    expect(pub).toContain("RAISE EXCEPTION 'exam_answer_keys_incomplete: %', missing_keys;");
    expect(pub).toContain("|| '第 ' || q.position || ' 題', '、'");
    expect(pub).toContain("WHERE q.paper_id=pr.id AND q.section<>'shortanswer' AND q.answer_key IS NULL;");
  });

  it("counts attempts whose short answers are not graded yet", () => {
    expect(fnBody("exam_publish_results")).toContain(
      "RAISE EXCEPTION 'exam_grading_incomplete: 還有 % 份作答的簡答題沒批改完', n_ungraded;"
    );
  });

  it("checks run before results are published", () => {
    const pub = fnBody("exam_publish_results");
    expect(pub.indexOf("exam_answer_keys_incomplete")).toBeLessThan(pub.indexOf("SET results_published_at=NOW()"));
    expect(pub.indexOf("exam_grading_incomplete")).toBeLessThan(pub.indexOf("SET results_published_at=NOW()"));
  });
});

describe("frontend (#299)", () => {
  it("no auto-score toggle, badge or manual recompute button", () => {
    expect(exam).not.toContain('data-exam-act="autoscore"');
    expect(exam).not.toContain("自動評分關閉");
    expect(exam).not.toContain("setExamAutoScore");
    expect(exam).not.toContain("exam-ak-recompute");
    expect(db).not.toContain("async setExamAutoScore(");
  });

  it("the answer-key tab explains automatic rescoring and reports how many were rescored", () => {
    const tab = exam.slice(exam.indexOf("function renderExamAnswerKeys"), exam.indexOf("// ── 簡答批改佇列"));
    expect(tab).toContain("改了正解，所有人的分數會自動重新計算");
    expect(tab).toContain("份作答的分數已重新計算");
  });

  it("publish errors show the server's detail", () => {
    expect(db).toContain("raw.match(/exam_answer_keys_incomplete:\\s*([^\\n]+)/)");
    expect(db).toContain("raw.match(/exam_grading_incomplete:\\s*([^\\n]+)/)");
  });

  it("exam_set_auto_score is no longer callable through nlc-data", () => {
    expect(nlcData).not.toContain('"exam_set_auto_score"');
  });
});
