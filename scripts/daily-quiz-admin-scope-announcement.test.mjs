import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { currentMigrationSql, latestFunctionDefinition } from "./migration-sql.mjs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sql = currentMigrationSql("0195_daily_quiz_admin_scope_and_scoped_announcement.sql");
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

// 0195 的「僅系統管理員（測試用）」發佈分支與「同時發首頁公告」在 #306／#308 拿掉了：
// 現在只剩自動發佈（見 daily-quiz-auto-publish.test.mjs），範圍只有 group/zone/region/all。
describe("publish_daily_quiz: the 0195 admin branch is gone (#308)", () => {
  const fn = latestFunctionDefinition("publish_daily_quiz").text;

  it("no longer accepts the admin scope or posts a home announcement", () => {
    expect(fn).not.toContain("IF p_scope_type = 'admin' THEN");
    expect(fn).toContain("IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN");
    expect(fn).not.toContain("schedule_announcement");
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

describe("get_daily_quiz_dashboard: myQuiz comes from the member's own group publication", () => {
  it("matches group publications via profile_belongs_to_quiz_group only (admin scope removed in #308)", () => {
    const fn = latestFunctionDefinition("get_daily_quiz_dashboard").text;
    expect(fn).toMatch(/AND publication\.scope_type = 'group'\s+AND public\.profile_belongs_to_quiz_group\(actor_id, publication\.small_group_id\)/);
    expect(fn).not.toContain("actor_role = 'admin'");
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
