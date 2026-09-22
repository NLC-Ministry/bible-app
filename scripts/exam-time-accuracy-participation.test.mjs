import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0197_exam_time_accuracy_participation.sql");
const exam = read("js/modules/exam.js");

describe("0197: exam_get_my_result gains timeSeconds + accuracyRate", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_get_my_result"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_get_my_result"));

  it("timeSeconds is available as soon as the attempt is submitted, not gated by show_full", () => {
    expect(fn).toContain("'timeSeconds',CASE WHEN at.status IN('submitted','graded')AND at.submitted_at IS NOT NULL AND at.started_at IS NOT NULL");
    expect(fn).toContain("EXTRACT(EPOCH FROM(at.submitted_at-at.started_at))");
  });

  it("accuracyRate/accuracyCorrect/accuracyTotal are gated by the same show_full flag as autoCorrect", () => {
    expect(fn).toContain("IF show_full THEN");
    expect(fn).toContain("INTO accuracy_correct,accuracy_total");
    expect(fn).toContain("'accuracyRate',CASE WHEN show_full AND COALESCE(accuracy_total,0)>0");
    expect(fn).toContain("q.section<>'shortanswer'");
  });

  it("keeps the recursive team_root CTE's root condition exactly as the prior migration (0194) defined it", () => {
    expect(fn).toContain("OR NOT EXISTS(SELECT 1 FROM public.reading_teams p WHERE p.id=rt.carried_from_team_id)");
    expect(fn).not.toContain("p.carried_from_team_id=rt.id");
  });
});

describe("0197: exam_get_stats gains overall.eligibleCount/participationRate and roster[].timeSeconds", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.exam_get_stats"),
    sql.indexOf("COMMENT ON FUNCTION public.exam_get_stats"));

  it("eligible_count reuses the same scope filter (mreg/mzon/mgrp) as the existing scoped-attempts query", () => {
    expect(fn).toContain("SELECT COUNT(*)INTO eligible_count");
    expect(fn).toContain("p.is_active=TRUE AND(");
    expect(fn).toContain("role_c='great_zone_leader' AND p.great_region=ANY(mreg)");
  });

  it("eligible population narrows to the linked plan's registered readers when the paper is bound to one", () => {
    expect(fn).toContain("pr.linked_plan_id IS NULL OR EXISTS(");
    expect(fn).toContain("rp.global_plan_id=pr.linked_plan_id");
  });

  it("overall exposes eligibleCount and participationRate (submitted / eligible, null when eligible is 0)", () => {
    expect(fn).toContain("'eligibleCount',eligible_count");
    expect(fn).toContain("'participationRate',CASE WHEN eligible_count>0");
  });

  it("roster rows carry timeSeconds regardless of grading/publish state", () => {
    expect(fn).toContain("'timeSeconds',CASE WHEN a.submitted_at IS NOT NULL AND a.started_at IS NOT NULL");
  });

  it("keeps the teamRanking recursive CTE's root condition exactly as the prior migration (0170) defined it", () => {
    expect(fn).toContain("OR NOT EXISTS(SELECT 1 FROM public.reading_teams p WHERE p.id=rt.carried_from_team_id)");
    expect(fn).not.toContain("p.carried_from_team_id=rt.id");
  });
});

describe("0197: 會友成績頁顯示作答時間與答對率", () => {
  it("defines a shared fmtExamSeconds helper and reuses it for the member result tiles", () => {
    expect(exam).toContain('const fmtExamSeconds = (secs) => (secs == null ? null : secs >= 60');
    expect(exam).toContain("const timeDisplay = fmtExamSeconds(d.timeSeconds);");
  });

  it("renders time/accuracy tiles independent of the PR block (not gated by showPr)", () => {
    expect(exam).toContain('const metaBlockHtml = (timeDisplay == null && accuracyDisplay == null) ? "" : `');
    expect(exam).toContain('const accuracyDisplay = d.accuracyRate == null ? null : `${Math.round(d.accuracyRate * 100)}%`;');
  });

  it("metaBlockHtml is inserted into the template before the PR block", () => {
    const idx = exam.indexOf("${metaBlockHtml}");
    const prIdx = exam.indexOf("${prBlockHtml}");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(prIdx);
  });
});

describe("0197: 後台統計顯示參與率大數字 + 名單新增作答時間欄", () => {
  it("adds a 參與率 tile next to the existing 作答 tile, guarded by eligibleCount presence", () => {
    expect(exam).toContain('<span>參與率（${num(o.submitted)}／${num(o.eligibleCount)}）</span>');
  });

  it("roster table and CSV export both gain an 作答時間 column", () => {
    expect(exam).toContain('{ h: "作答時間", f: (r) => fmtExamSeconds(r.timeSeconds) ?? "—" }');
    expect(exam).toContain('"作答時間（秒）"');
    expect(exam).toContain("r.status, r.autoScore, r.manualScore, r.totalScore, r.submittedAt, r.timeSeconds");
  });
});
