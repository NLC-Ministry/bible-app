import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql } from "./migration-sql.mjs";

// #298（大測驗 R1，屬於 #297）：排程後首頁卡片自動出現、題目可改到開放作答、
// 只有開放前能取消排程、首頁卡片文字沒填時自動產生。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = currentMigrationSql("20260928031148_exam_schedule_shows_home_card.sql");
const exam = read("js/modules/exam.js");
const home = read("js/modules/home.js");
const db = read("js/db.js");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

describe("migration: five stages derived from existing columns", () => {
  it("_exam_paper_stage maps status/open_at/results_published_at to the five stages", () => {
    const stage = fnBody("_exam_paper_stage");
    expect(stage).toContain("WHEN p_results_published_at IS NOT NULL THEN 'published'");
    expect(stage).toContain("WHEN p_status = 'draft' THEN 'preparing'");
    expect(stage).toContain("WHEN p_status = 'published' AND (p_open_at IS NULL OR NOW() < p_open_at) THEN 'scheduled'");
    expect(stage).toContain("WHEN p_status = 'published' THEN 'open'");
    expect(stage).toContain("ELSE 'grading'");
  });

  it("new helpers are service_role-only, and the migration fails if any exam function is anon-executable", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._exam_paper_stage(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public._exam_paper_stage(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._exam_default_card_body(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});

describe("migration: scheduling puts the card on the home page", () => {
  it("exam_publish no longer requires a published announcement", () => {
    expect(fnBody("exam_publish")).not.toContain("exam_not_announced");
    expect(fnBody("exam_publish")).not.toContain("announcement_published");
  });

  it("home, banner and my-papers show every scheduled/open/closed paper and never a draft", () => {
    for (const name of ["exam_home_exams", "exam_home_banner", "exam_my_papers"]) {
      const body = fnBody(name);
      expect(body, name).toContain("pr.status IN ('published', 'closed')");
      expect(body, name).not.toContain("announcement_published");
      expect(body, name).not.toContain("pre_announcement");
    }
  });

  it("card text falls back to the paper title and a generated schedule line", () => {
    const summary = fnBody("_exam_member_paper_summary");
    expect(summary).toContain("disp_headline:=COALESCE(NULLIF(btrim(pr.announcement->>'headline'),''),pr.title);");
    expect(summary).toContain("public._exam_default_card_body(pr.open_at,pr.close_at,pr.duration_minutes)");
    expect(summary).toContain("'isPreAnnouncement',FALSE");
    expect(summary).not.toContain("pre_announcement");
    const body = fnBody("_exam_default_card_body");
    expect(body).toContain("AT TIME ZONE 'Asia/Taipei'");
    expect(body).toContain("' 開放，至 '");
    expect(body).toContain("'；作答限時 ' || p_duration_minutes || ' 分鐘。'");
  });

  it("saving blank card text is allowed now that it has defaults", () => {
    expect(fnBody("exam_save_announcement")).not.toContain("exam_announcement_would_blank_published");
    expect(fnBody("exam_save_announcement")).toContain("WHERE id = p_paper_id AND status <> 'closed'");
  });
});

describe("migration: questions stay editable until the paper opens", () => {
  it("paper and question edits are allowed while preparing or scheduled", () => {
    for (const name of ["exam_upsert_paper", "exam_upsert_question"]) {
      expect(fnBody(name), name).toContain("IF stage NOT IN ('preparing', 'scheduled') THEN RAISE EXCEPTION 'exam_paper_not_editable'; END IF;");
    }
  });

  it("scheduled papers keep their structure: no section changes, new questions or deletions", () => {
    expect(fnBody("exam_upsert_paper")).toContain("IF stage = 'scheduled' AND v_sections IS NOT NULL AND v_sections IS DISTINCT FROM pr.sections THEN");
    expect(fnBody("exam_upsert_question")).toContain("IF stage = 'scheduled' THEN RAISE EXCEPTION 'exam_scheduled_structure_locked'; END IF;");
    expect(fnBody("exam_delete_question")).toContain("RAISE EXCEPTION 'exam_scheduled_structure_locked';");
  });

  it("a scheduled paper's new times get the same window check as scheduling", () => {
    const paper = fnBody("exam_upsert_paper");
    expect(paper).toContain("IF stage = 'scheduled' AND (row_out.open_at IS NULL OR row_out.close_at IS NULL");
    expect(paper).toContain("OR row_out.close_at <= row_out.open_at OR row_out.close_at <= NOW()) THEN");
  });

  it("answer keys and explanations keep their own rules (grading-stage corrections, #299)", () => {
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.exam_set_answer_key(");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.exam_set_question_explanation(");
  });
});

describe("migration: unschedule only before opening", () => {
  it("reverting to draft is only allowed while scheduled", () => {
    const status = fnBody("exam_set_status");
    expect(status).toContain("IF p_status = 'draft' AND pr.status <> 'draft' AND stage <> 'scheduled' THEN");
    expect(status).toContain("RAISE EXCEPTION 'exam_already_open';");
    expect(status).not.toContain("exam_revert_has_attempts");
  });

  it("a scheduled paper cannot be closed before it opens", () => {
    expect(fnBody("exam_set_status")).toContain("IF stage = 'scheduled' THEN RAISE EXCEPTION 'exam_use_unschedule'; END IF;");
  });
});

describe("migration: rehearsal attempts while preparing or scheduled, cleared at opening", () => {
  it("attempts started before opening are rehearsal", () => {
    expect(fnBody("exam_start_attempt")).toContain(
      // 20260929084154（#339）把判斷抽成 is_rehearsal 變數
      "is_rehearsal := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) IN ('preparing', 'scheduled');"
    );
  });

  it("staff can rehearse a scheduled paper from the exam page", () => {
    expect(fnBody("exam_get_for_attempt")).toContain(
      "ELSIF pr.status = 'draft' OR (pr.status = 'published' AND now_ts < pr.open_at) THEN"
    );
  });

  it("the per-minute sweep deletes rehearsal attempts once a paper has opened", () => {
    const sweep = fnBody("_exam_close_expired_papers");
    expect(sweep).toContain("DELETE FROM public.exam_attempts a USING public.exam_papers pr");
    expect(sweep).toContain("WHERE a.paper_id=pr.id AND a.is_test AND pr.status IN('published','closed')");
    expect(sweep).toContain("AND pr.open_at IS NOT NULL AND pr.open_at<=NOW();");
  });

  it("clearing rehearsals works while preparing or scheduled and never touches real attempts", () => {
    for (const name of ["exam_reset_attempts", "exam_reset_my_rehearsal"]) {
      const body = fnBody(name);
      expect(body, name).toContain("NOT IN ('preparing', 'scheduled') THEN");
      expect(body, name).toContain("AND is_test;");
    }
  });

  it("the admin payload carries the server-computed stage", () => {
    const admin = fnBody("exam_get_paper_admin");
    expect(admin).toContain("'paper',to_jsonb(pr)||jsonb_build_object('stage',public._exam_paper_stage(pr.status,pr.open_at,pr.results_published_at)),");
    expect(admin).toContain("'testAttemptCount'");
    expect(admin).toContain("'serverNow',NOW()");
  });
});

describe("admin UI (#298)", () => {
  it("derives the stage with the shared examStage (#300, see exam-stage.test.mjs)", () => {
    expect(exam).toContain('import { EXAM_STAGES, examStage, examNextStepText, formatExamTime } from "./exam-stage.mjs";');
    expect(exam).toContain("const stage = examStage(paper);");
  });

  it("the checklist no longer asks for a published announcement", () => {
    const fn = exam.slice(exam.indexOf("function examReadinessChecklist"), exam.indexOf("function examChecklistHtml"));
    expect(fn).not.toContain("announcement");
  });

  it("scheduled papers show 取消排程 and no close button; open papers can be closed", () => {
    const scheduled = exam.slice(exam.indexOf("} else if (isScheduled) {"), exam.indexOf('} else if (stage === "open") {'));
    expect(scheduled).toContain('data-exam-act="reopen">取消排程</button>');
    expect(scheduled).not.toContain('data-exam-act="close"');
    const open = exam.slice(exam.indexOf('} else if (stage === "open") {'), exam.indexOf('} else if (stage === "grading"'));
    expect(open).toContain('data-exam-act="close">提前結束</button>');
  });

  it("the question bank hides add/delete while scheduled", () => {
    const bank = exam.slice(exam.indexOf("function renderExamQuestionBank"), exam.indexOf("function qEditCard"));
    expect(bank).toContain('const structureLocked = stage === "scheduled";');
    expect(bank).toContain("qEditCard(sec, q, cfg[sec], { allowDelete: !structureLocked })");
    expect(bank).toContain('${structureLocked ? "" : `<button type="button" class="secondary-btn" data-add-q="${sec}">');
    expect(exam).toContain("${q && allowDelete ? '<button type=\"button\" class=\"exam-admin__link exam-admin__link--danger\" data-q-del>刪除</button>' : \"\"}");
  });

  it("the settings form locks sections while scheduled and leaves them out of the save", () => {
    const meta = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("// ── 政策性說明改成小圖示"));
    expect(meta).toContain('const structureLocked = examStage(p) === "scheduled";');
    expect(meta).toContain("const sections = structureLocked ? undefined : collectSections();");
  });

  it("the card-text form previews the same default body as the server", () => {
    const form = exam.slice(exam.indexOf("function examDefaultCardBody"), exam.indexOf("// ── 試卷設定表單"));
    // 時間格式跟伺服器一樣用台北時間（formatExamTime，見 exam-stage.test.mjs）
    expect(form).toContain("${formatExamTime(paper.open_at)} 開放，至 ${formatExamTime(paper.close_at)} 截止");
    expect(form).toContain("；作答限時 ${paper.duration_minutes} 分鐘。");
  });

  it("explains new error codes", () => {
    expect(db).toContain("exam_scheduled_structure_locked:");
    expect(db).toContain("exam_already_open:");
    expect(db).toContain("exam_use_unschedule:");
  });
});

describe("member home card (#298)", () => {
  it("grading: attempted members are told results will be notified; others see 已收卷", () => {
    const fn = home.slice(home.indexOf("function getExamHomeCardState"), home.indexOf("async function refreshExamHomeBanner"));
    expect(fn).toContain('badge = grading ? "批改中" : "已完成作答";');
    expect(fn).toContain('"已完成作答，成績公布後會通知你。"');
    expect(fn).toContain('badge = "已收卷";');
  });
});
