import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #303（大測驗 R6，屬於 #297）：刪掉新流程用不到的舊欄位、函式與 exam.html 的預覽模式。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260929041621_exam_drop_legacy_columns.sql");
const exam = read("js/modules/exam.js");
const entry = read("js/exam-entry.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const REMOVED_RPCS = [
  "exam_publish_announcement",
  "exam_unpublish_announcement",
  "exam_save_pre_announcement",
  "exam_set_auto_score"
];

describe("migration", () => {
  it("drops the four legacy functions with their exact signatures", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.exam_publish_announcement(uuid, uuid);");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.exam_unpublish_announcement(uuid, uuid);");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.exam_save_pre_announcement(uuid, jsonb, boolean, uuid);");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.exam_set_auto_score(uuid, boolean, uuid);");
  });

  it("drops the four legacy columns without CASCADE and keeps the home-card text", () => {
    const alter = migration.slice(migration.indexOf("ALTER TABLE public.exam_papers"));
    for (const col of ["announcement_published", "pre_announcement", "pre_announcement_enabled", "auto_score_enabled"]) {
      expect(alter).toContain(`DROP COLUMN IF EXISTS ${col}`);
    }
    expect(alter).not.toContain("CASCADE");
    expect(alter).not.toMatch(/DROP COLUMN IF EXISTS announcement[,;]/);
  });

  describe("exam_get_for_attempt without the preview mode", () => {
    const fn = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.exam_get_for_attempt("),
      migration.indexOf("$$;", migration.indexOf("CREATE OR REPLACE FUNCTION public.exam_get_for_attempt(")));

    it("keeps the p_preview parameter so builds that still send it keep working", () => {
      expect(fn).toContain("p_preview boolean DEFAULT false");
      expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) TO authenticated, service_role;");
      expect(migration).toContain("REVOKE ALL ON FUNCTION public.exam_get_for_attempt(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;");
    });

    it("never returns questions before an attempt exists", () => {
      expect(fn).not.toContain("previewQuestions");
      expect(fn).not.toContain("want_preview");
      expect(fn).not.toContain("'preview'");
    });
  });
});

describe("frontend and nlc-data", () => {
  it("no removed RPC is callable through nlc-data or db.js", () => {
    for (const name of REMOVED_RPCS) {
      expect(nlcData, name).not.toContain(`"${name}"`);
      expect(db, name).not.toContain(`"${name}"`);
    }
    expect(db).not.toContain("publishExamAnnouncement");
    expect(db).not.toContain("unpublishExamAnnouncement");
  });

  it("exam.html has no preview mode left", () => {
    expect(entry).not.toContain("preview");
    expect(exam).not.toContain("this.preview");
    expect(exam).not.toContain("previewQuestions");
    expect(exam).not.toContain("關閉預覽");
    expect(db).not.toContain("p_preview");
  });
});
