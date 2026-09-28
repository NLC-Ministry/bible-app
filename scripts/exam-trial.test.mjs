import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #302（大測驗 R5，屬於 #297）：「試作」合併演練作答與預覽試卷；試作只有自己看得到，
// 不算進成績、統計、首頁卡片、我的測驗；開放作答時自動清除（#298）。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260928041142_exam_trial_attempts_out_of_stats.sql");
const exam = read("js/modules/exam.js");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$function$;", start));
};

describe("migration: trials stay out of the numbers", () => {
  it("every official-attempt query in exam_get_stats excludes trials", () => {
    const stats = fnBody("exam_get_stats");
    expect(stats).not.toMatch(/a\.attempt_kind='official'(?! AND NOT a\.is_test)/);
    expect(stats).not.toMatch(/a2\.attempt_kind='official'(?! AND NOT a2\.is_test)/);
    expect(stats.match(/NOT a2?\.is_test/g)).toHaveLength(8);
  });

  it("the scoped list everything else builds on excludes trials", () => {
    expect(fnBody("exam_get_stats")).toContain(
      "FROM public.exam_attempts a JOIN public.profiles p ON p.id=a.user_id\n  WHERE a.paper_id=pr.id AND a.attempt_kind='official' AND NOT a.is_test AND("
    );
  });

  it("team averages exclude trials", () => {
    expect(fnBody("_exam_team_avg_pop")).toContain("AND a.attempt_kind = 'official' AND NOT a.is_test AND a.status IN ('submitted', 'graded')");
  });

  it("a trial is scored as soon as it is submitted; official attempts still wait for closing", () => {
    const submit = fnBody("exam_submit_attempt");
    expect(submit).toContain("IF at.is_test THEN PERFORM public._exam_score_attempt(at.id); END IF;");
    expect(submit.indexOf("_exam_score_attempt")).toBeGreaterThan(submit.indexOf("UPDATE public.exam_attempts SET status='submitted'"));
  });

  it("keeps grants and the anon check", () => {
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.exam_get_stats(uuid, uuid, boolean, text, integer) TO authenticated, service_role;");
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});

describe("admin UI: one 試作 button (#302)", () => {
  const panel = exam.slice(exam.indexOf("export async function renderExamPanel"), exam.indexOf("// ── 不能改的時候，分頁上面那一句原因"));

  it("preparing/scheduled show a single 試作 link and no preview link", () => {
    expect(panel).toContain('rel="noopener">試作</a>');
    expect(panel).not.toContain("preview=1");
    expect(exam).not.toContain("預覽試卷</a>");
  });

  it("the results tab ignores trials", () => {
    expect(panel).toContain("const realAttemptCount = Math.max(0, attemptCount - (paperRes.data?.testAttemptCount || 0));");
    expect(panel).toContain("if (realAttemptCount === 0) {");
  });

  it("clearing trials is worded as 試作", () => {
    expect(panel).toContain('data-exam-act="reset">清除所有試作（${rehearsalCount}）</button>');
  });
});

describe("exam runner wording (#302)", () => {
  it("the trial result page says 試作 and offers 重新試作", () => {
    expect(exam).toContain("這是<strong>試作</strong>，不列入成績，只有你自己看得到；開放作答時會自動清除。");
    expect(exam).toContain('id="exam-result-rehearse-again">重新試作</button>');
  });

  it("no user-facing 演練 left", () => {
    const codeOnly = exam.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    expect(codeOnly).not.toContain("演練");
  });
});
