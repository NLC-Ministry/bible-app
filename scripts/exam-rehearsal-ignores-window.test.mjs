import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkExamScheduleWindow, isExamWindowExpired } from "../js/modules/exam-schedule-window.mjs";

// #339：試作一進去就「作答完成」——準備中的卷留著過期的開放時間，試作的截止時間
// 被夾到 close_at。試作改成不受開放時間影響；開放時間改在「排程」視窗裡選。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260929084154_exam_rehearsal_ignores_window.sql");
const exam = read("js/modules/exam.js");
const db = read("js/db.js");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf("$$;", migration.indexOf("AS $$", start)));
};

describe("migration: rehearsal deadline ignores the paper's window", () => {
  const body = fnBody("exam_start_attempt");

  it("rehearsal = preparing or scheduled, and the same flag marks is_test", () => {
    expect(body).toContain("is_rehearsal := public._exam_paper_stage(pr.status, pr.open_at, pr.results_published_at) IN ('preparing', 'scheduled');");
    expect(body).toMatch(/VALUES \(pr\.id, actor_id, p_reading_team_id,\s+is_rehearsal,/);
  });

  it("a rehearsal gets the full time limit, without looking at close_at", () => {
    const branch = body.slice(body.indexOf("IF is_rehearsal THEN"), body.indexOf("ELSE", body.indexOf("IF is_rehearsal THEN")));
    expect(branch).toContain("deadline := now_ts + make_interval(mins => pr.duration_minutes);");
    expect(branch).not.toContain("close_at");
  });

  it("an official attempt still stops at close_at", () => {
    const official = body.slice(body.indexOf("ELSE", body.indexOf("IF is_rehearsal THEN")), body.indexOf("END IF;", body.indexOf("IF is_rehearsal THEN")));
    expect(official).toContain("deadline := LEAST(now_ts + make_interval(mins => pr.duration_minutes),");
    expect(official).toContain("COALESCE(pr.close_at, now_ts + make_interval(mins => pr.duration_minutes)));");
  });

  it("members still can't start outside the window", () => {
    expect(body).toContain("IF pr.status <> 'published' OR now_ts < pr.open_at OR now_ts >= pr.close_at THEN");
    expect(body).toContain("RAISE EXCEPTION 'exam_not_open';");
  });

  it("keeps the same grants and fails if any exam function is anon-executable", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.exam_start_attempt(uuid, text, uuid, uuid) FROM PUBLIC, anon;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.exam_start_attempt(uuid, text, uuid, uuid) TO authenticated, service_role;");
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});

describe("checkExamScheduleWindow", () => {
  const now = Date.parse("2026-09-29T10:00:00+08:00");
  const at = hhmm => `2026-09-${hhmm}+08:00`;

  it("blocks when a time is missing", () => {
    expect(checkExamScheduleWindow({ openAt: null, closeAt: at("30T10:00:00"), durationMinutes: 60, now }).errors)
      .toEqual(["請選擇開始和結束時間。"]);
  });

  it("blocks when the end is not after the start", () => {
    const r = checkExamScheduleWindow({ openAt: at("30T12:00:00"), closeAt: at("30T11:00:00"), durationMinutes: 60, now });
    expect(r.errors).toContain("結束時間要晚於開始時間。");
  });

  it("blocks an end time that has already passed (the 9/22 leftover case)", () => {
    const r = checkExamScheduleWindow({ openAt: at("22T09:00:00"), closeAt: at("22T21:00:00"), durationMinutes: 60, now });
    expect(r.errors).toEqual(["結束時間已經過了，請選擇未來的時間。"]);
    expect(r.warnings).toEqual([]);
  });

  it("warns (but allows) a window shorter than the time limit", () => {
    const r = checkExamScheduleWindow({ openAt: at("30T09:00:00"), closeAt: at("30T09:30:00"), durationMinutes: 75, now });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(["開放時段只有 30 分鐘，比作答時限 75 分鐘短：會友可能會在寫完前被提早收卷。"]);
  });

  it("warns (but allows) a start time that has passed: it opens right away", () => {
    const r = checkExamScheduleWindow({ openAt: at("29T09:00:00"), closeAt: at("30T21:00:00"), durationMinutes: 60, now });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(["開始時間已經過了，排程後會立刻開放作答。"]);
  });

  it("a normal future window has no messages", () => {
    expect(checkExamScheduleWindow({ openAt: at("30T09:00:00"), closeAt: at("30T21:00:00"), durationMinutes: 75, now }))
      .toEqual({ errors: [], warnings: [] });
  });

  it("marks a leftover window as expired only when its end has passed", () => {
    expect(isExamWindowExpired({ close_at: at("22T21:00:00") }, now)).toBe(true);
    expect(isExamWindowExpired({ close_at: at("30T21:00:00") }, now)).toBe(false);
    expect(isExamWindowExpired({ close_at: null }, now)).toBe(false);
  });
});

describe("admin UI: the window is chosen when scheduling", () => {
  it("the readiness checklist no longer asks for a window", () => {
    const fn = exam.slice(exam.indexOf("function examReadinessChecklist"), exam.indexOf("function examChecklistHtml"));
    expect(fn).not.toContain("開放時間");
    expect(fn).not.toContain("open_at");
  });

  it("the settings form has no open/close inputs and doesn't save them", () => {
    const meta = exam.slice(exam.indexOf("function renderExamMetaForm"), exam.indexOf("// ── 政策性說明改成小圖示"));
    expect(meta).not.toContain('data-f="open_at"');
    expect(meta).not.toContain('data-f="close_at"');
    expect(meta).not.toContain("open_at: fromLocalInput");
    expect(meta).toContain("開放時間：按「排程」時選擇。");
  });

  it("排程 opens the modal, saves the window, then publishes", () => {
    const handler = exam.slice(exam.indexOf('if (act === "publish" || act === "reschedule") {'), exam.indexOf('if (act === "close" && !confirm('));
    expect(handler).toContain("openExamScheduleModal(paper, { reschedule, rehearsalCount }");
    expect(handler).toContain("db.upsertExamPaper({ id: paper.id, open_at: openAt, close_at: closeAt })");
    expect(handler.indexOf("db.upsertExamPaper")).toBeLessThan(handler.indexOf("db.publishExam(paper.id)"));
    expect(handler).toContain("if (!reschedule) {");
    expect(exam).not.toContain('act === "publish" && !confirm(');
  });

  it("a scheduled paper can change its window from the same modal", () => {
    expect(exam).toContain(`if (isScheduled) tools.push('<button type="button" class="secondary-btn" data-exam-act="reschedule">改開放時間</button>');`);
  });

  it("the modal blocks errors, flags warnings as 仍要…, and marks a leftover expired window", () => {
    const modal = exam.slice(exam.indexOf("function openExamScheduleModal"), exam.indexOf("export async function renderExamPanel"));
    expect(modal).toContain("checkExamScheduleWindow({ ...values(), durationMinutes: paper.duration_minutes })");
    expect(modal).toContain("confirmBtn.disabled = errors.length > 0;");
    expect(modal).toContain("confirmBtn.textContent = warnings.length ? `仍要${baseLabel}` : baseLabel;");
    expect(modal).toContain("原本的開放時間已過期，請重新選擇。");
    expect(modal).toContain('value="${esc(toLocalInput(paper.open_at))}"');
  });

  it("explains exam_window_invalid in terms of the modal", () => {
    expect(db).toContain('exam_window_invalid: "開放時間不正確：結束時間要晚於開始時間，而且要在未來。請重新選擇。"');
  });
});

describe("runner: no silent auto-submit when an attempt starts with no time left", () => {
  it("shows 作答時間已到 instead of booting into the runner", () => {
    const start = exam.slice(exam.indexOf("  async start(pledgeName) {"), exam.indexOf("  // ── 作答畫面 ──"));
    expect(start).toContain("if (!res.data?.resumed && res.data?.secondsRemaining != null && Number(res.data.secondsRemaining) <= 0) {");
    expect(start).toContain("作答時間已到");
    expect(start.indexOf("作答時間已到")).toBeLessThan(start.indexOf("return this.boot();"));
  });
});
