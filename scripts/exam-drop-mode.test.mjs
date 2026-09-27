import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #260（大測驗 C3）：C1 改成單一試卷、C2 刪掉舊測試卷之後，移除 exam_papers.mode、
// pushed_from_id、試考名單與相關函式。exam_attempts.is_test 保留（演練作答）。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260927051721_exam_drop_mode_and_testers.sql");
const sqlOnly = migration.split(/\r?\n/).filter(l => !l.trim().startsWith("--")).join("\n");

const REWRITTEN = [
  "_exam_member_paper_summary", "exam_get_for_attempt", "exam_get_paper_admin", "exam_get_stats",
  "exam_home_banner", "exam_home_exams", "exam_my_papers", "exam_publish", "exam_reset_attempts",
  "exam_start_attempt", "exam_start_practice", "exam_upsert_paper"
];

const fnBlock = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION "public"."${name}"(`);
  expect(start, `${name} is rewritten`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("-- ──", start + 1));
};

describe("C3 migration", () => {
  it("refuses to run while legacy test data is still there", () => {
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM public.exam_papers WHERE mode <> 'live') THEN");
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM public.exam_papers WHERE pushed_from_id IS NOT NULL) THEN");
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM public.exam_paper_testers) THEN");
    // 檢查要在刪除之前
    expect(migration.indexOf("run C2 (#259) first")).toBeLessThan(migration.indexOf("DROP COLUMN IF EXISTS mode"));
  });

  it.each(REWRITTEN)("%s no longer reads mode or pushed_from_id, and keeps its grants", name => {
    const block = fnBlock(name);
    expect(block).not.toMatch(/pr\.mode\b|\bmode\s*=\s*'(test|live)'|'mode'\s*,|pushed_from/);
    expect(block).toMatch(new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${name}"\\([^)]*\\) FROM PUBLIC, anon;`));
    expect(block).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION "public"\\."${name}"\\([^)]*\\) TO authenticated, service_role;`));
  });

  it("keeps the rehearsal rule: attempts on a draft are is_test", () => {
    expect(fnBlock("exam_start_attempt")).toContain("(pr.status = 'draft'),");
    expect(fnBlock("exam_publish")).toContain("DELETE FROM public.exam_attempts WHERE paper_id = pr.id AND is_test;");
    expect(fnBlock("exam_publish")).toContain("IF NOT pr.announcement_published THEN");
    expect(fnBlock("exam_reset_attempts")).toContain("IF pr.status <> 'draft' THEN");
  });

  it("drops the removed functions, the tester table, and both columns", () => {
    for (const sig of [
      "exam_push_to_live(uuid, uuid)", "exam_set_mode(uuid, text, uuid)", "exam_add_tester(uuid, text, uuid)",
      "exam_remove_tester(uuid, uuid, uuid)", "exam_get_paper_testers(uuid, uuid)", "_exam_can_access_test(uuid, uuid)"
    ]) {
      expect(sqlOnly).toContain(`DROP FUNCTION IF EXISTS public.${sig};`);
    }
    expect(sqlOnly).toContain("DROP TABLE IF EXISTS public.exam_paper_testers;");
    expect(sqlOnly).toContain("ALTER TABLE public.exam_papers DROP COLUMN IF EXISTS pushed_from_id;");
    expect(sqlOnly).toContain("ALTER TABLE public.exam_papers DROP COLUMN IF EXISTS mode;");
    expect(sqlOnly).not.toMatch(/DROP COLUMN[^;]*is_test/);
  });

  it("fails if any function still references the removed columns", () => {
    expect(migration).toContain("RAISE EXCEPTION 'functions still reference removed exam columns: %'");
  });
});

describe("frontend no longer knows about exam mode", () => {
  it("exam.js and home.js have no mode checks", () => {
    const exam = read("js/modules/exam.js");
    const home = read("js/modules/home.js");
    expect(exam).not.toMatch(/\.mode\s*[!=]==\s*"(test|live)"/);
    expect(home).not.toMatch(/d\.mode\s*===\s*"test"/);
    expect(exam).not.toMatch(/pushedFromId|pushed_from_id/);
  });
});
