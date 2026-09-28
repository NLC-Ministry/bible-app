import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/0195_daily_quiz_admin_scope_and_scoped_announcement.sql");
const admin = read("js/modules/admin.js");
const db = read("js/db.js");

describe("0195: quiz_publications 'admin' scope", () => {
  it("small_group_id becomes nullable, scope_type discriminates the row shape", () => {
    expect(sql).toContain("ALTER COLUMN small_group_id DROP NOT NULL");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS scope_type TEXT NOT NULL DEFAULT 'group'");
    expect(sql).toContain("CHECK (scope_type IN ('group', 'admin'))");
    expect(sql).toContain("(scope_type = 'group' AND small_group_id IS NOT NULL)");
    expect(sql).toContain("(scope_type = 'admin' AND small_group_id IS NULL)");
  });

  it("one admin-scope publication per plan/date, enforced by a partial unique index", () => {
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_publications_admin_scope");
    expect(sql).toContain("ON public.quiz_publications(global_plan_id, quiz_date)");
    expect(sql).toContain("WHERE scope_type = 'admin'");
  });

  it("schedule table's scope_type CHECK also allows 'admin'", () => {
    expect(sql).toContain("ADD CONSTRAINT quiz_publication_schedules_scope_type_check");
    expect(sql).toContain("CHECK (scope_type IN ('group', 'zone', 'region', 'all', 'admin'))");
  });
});

describe("0195: publish_daily_quiz 'admin' branch", () => {
  const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.publish_daily_quiz"),
    sql.indexOf("REVOKE ALL ON FUNCTION public.publish_daily_quiz"));

  it("only admin/pastor may publish to the admin scope (not zone/group leaders)", () => {
    expect(fn).toContain("IF p_scope_type = 'admin' THEN");
    expect(fn).toContain("IF actor_role NOT IN ('admin', 'pastor') THEN\n      RAISE EXCEPTION 'quiz_publish_scope_required';");
    expect(fn).toContain("'group', 'zone', 'region', 'all', 'admin'");
  });

  it("targets every active admin profile directly, bypassing the small_group model entirely", () => {
    expect(fn).toContain("p_global_plan_id, p_quiz_date, selected_quiz_id, NULL, 'admin', actor_id, actor_role, p_answer_close_at");
    expect(fn).toContain("ON CONFLICT (global_plan_id, quiz_date) WHERE scope_type = 'admin' DO UPDATE");
    expect(fn).toContain("public.role_code(profile.role_id) = 'admin'");
    expect(fn).toContain("每日小測驗（測試發布）已發布，完成後即可查看結果。");
  });

  it("no longer requires scope='all' to also post an announcement, and forwards the same scope to it", () => {
    expect(fn).not.toContain("quiz_announcement_requires_church_wide");
    expect(fn).toContain("PERFORM public.schedule_announcement(");
    expect(fn).toContain("p_scope_type,\n      p_scope_name\n    );");
  });
});

describe("0195: church_announcements audience scope", () => {
  it("adds nullable scope columns; NULL/'all' keeps the existing church-wide behavior", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS audience_scope_type TEXT");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS audience_scope_name TEXT");
    expect(sql).toContain("CHECK (audience_scope_type IS NULL OR audience_scope_type IN ('all', 'region', 'zone', 'group', 'admin'))");
  });

  it("profile_matches_announcement_scope: NULL/all always true, admin checks role_code, others check the matching profile field", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.profile_matches_announcement_scope"),
      sql.indexOf("$profile_matches_announcement_scope$;"));
    expect(fn).toContain("WHEN p_scope_type IS NULL OR p_scope_type = 'all' THEN TRUE");
    expect(fn).toContain("public.role_code(p.role_id) = 'admin'");
    expect(fn).toContain("public.values_overlap(p.great_region, p_scope_name)");
    expect(fn).toContain("public.values_overlap(p.pastoral_zone, p_scope_name)");
    expect(fn).toContain("public.values_overlap(p.small_group, p_scope_name)");
  });

  it("RLS policy gates on scope match, admin still bypasses regardless of scope", () => {
    expect(sql).toContain("DROP POLICY IF EXISTS announcements_read_published ON public.church_announcements");
    expect(sql).toContain("(is_published = TRUE AND public.profile_matches_announcement_scope(public.current_profile_id(), audience_scope_type, audience_scope_name))");
    expect(sql).toContain("(SELECT my_role FROM public.get_my_profile()) = 'admin'");
  });

  it("schedule_announcement stores 'all' as NULL and only keeps a scope_name for region/zone/group", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.schedule_announcement"),
      sql.indexOf("REVOKE ALL ON FUNCTION public.schedule_announcement"));
    expect(fn).toContain("NULLIF(p_scope_type, 'all')");
    expect(fn).toContain("CASE WHEN p_scope_type IN ('region', 'zone', 'group') THEN p_scope_name ELSE NULL END");
  });
});

describe("0195: get_daily_quiz_dashboard recognizes admin-scope publications as myQuiz", () => {
  it("matches group publications via profile_belongs_to_quiz_group, admin publications via actor_role", () => {
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.get_daily_quiz_dashboard"),
      sql.indexOf("COMMENT ON FUNCTION public.get_daily_quiz_dashboard"));
    expect(fn).toContain("(publication.scope_type = 'group' AND public.profile_belongs_to_quiz_group(actor_id, publication.small_group_id))");
    expect(fn).toContain("(publication.scope_type = 'admin' AND actor_role = 'admin')");
    // managedGroups (the per-group admin roster view) stays group-only — admin
    // test publications are personal, not mixed into any real group's stats.
    expect(fn).toContain("AND publication.scope_type = 'group'");
  });
});

// #306：「僅系統管理員（測試用）」範圍拿掉了——測試一律在 staging（見 #305 共用原則）。
describe("admin.js — 僅系統管理員 scope UI（#306 已移除）", () => {
  it("the scope selector no longer offers an admin-only toggle", () => {
    expect(admin).not.toContain("admin-only-toggle");
    expect(admin).not.toContain('return { scopeType: "admin", scopeName: null };');
    expect(admin).not.toContain("系統管理員（測試用）");
  });

  it("no longer locks region/zone/group selects for an admin-only scope", () => {
    expect(admin).not.toContain("isAdminOnlyScope");
  });

  // The "同時發佈到首頁公告" checkbox this test used to cover was removed
  // entirely in migration 0196 — see daily-church-quiz.test.mjs's
  // "no longer posts a home announcement..." test.
});

describe("db.js — postAnnouncement docs reflect the scope-bound behavior", () => {
  it("no longer documents the 'all'-only restriction as still true", () => {
    expect(db).not.toContain("quiz_announcement_requires_church_wide");
    expect(db).not.toContain("只有 scope.scopeType === \"all\" 才有意義");
  });
});
