import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #308（小測驗 Q3，屬於 #305）：清掉排程發佈、A／B 審核與手動發佈的舊東西。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20260929043341_daily_quiz_drop_legacy_publish.sql");
const edge = read("supabase/functions/nlc-data/index.ts");
const db = read("js/db.js");
const admin = read("js/modules/admin.js");
const sampleData = read("scripts/staging-sample-data.mjs");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is redefined`).toBeGreaterThanOrEqual(0);
  const bodyStart = migration.indexOf("AS $", start);
  const tag = migration.slice(bodyStart + 3, migration.indexOf("$", bodyStart + 4) + 1);
  return migration.slice(start, migration.indexOf(`${tag};`, bodyStart + 3 + tag.length));
};

const DROPPED = ["schedule_daily_quiz_publish", "cancel_daily_quiz_schedule",
  "request_daily_quiz_regeneration", "update_daily_quiz_questions"];

describe("migration", () => {
  it("drops every overload of the four legacy functions by name", () => {
    const block = migration.slice(migration.indexOf("DO $$"), migration.indexOf("END $$;"));
    for (const name of DROPPED) expect(block).toContain(`'${name}'`);
    expect(block).toContain("EXECUTE format('DROP FUNCTION %s', fn);");
  });

  it("drops quiz_publication_schedules without CASCADE", () => {
    expect(migration).toContain("DROP TABLE IF EXISTS public.quiz_publication_schedules;");
    expect(migration).not.toMatch(/CASCADE\s*;/);
  });

  it("the 5-minute sweep only runs the daily auto-publish now", () => {
    const sweep = fnBody("run_daily_quiz_schedule_sweep");
    expect(sweep).toContain("auto_result := public.run_daily_quiz_auto_publish();");
    expect(sweep).not.toContain("quiz_publication_schedules");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.run_daily_quiz_schedule_sweep() TO service_role;");
  });

  it("get_daily_quiz_dashboard returns only the caller's own quiz", () => {
    const dashboard = fnBody("get_daily_quiz_dashboard");
    expect(dashboard).toContain("'myQuiz', my_quiz");
    expect(dashboard).toContain("publication.scope_type = 'group'");
    for (const gone of ["quiz_publication_schedules", "reviewQuizzes", "approvedVariants",
      "managedGroups", "pendingSchedule", "scope_type = 'admin'"]) {
      expect(dashboard, gone).not.toContain(gone);
    }
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_daily_quiz_dashboard(uuid, date, uuid) TO authenticated, service_role;");
  });

  it("publish_daily_quiz is service_role-only, with no admin-scope branch and no B version", () => {
    const publish = fnBody("publish_daily_quiz");
    expect(publish).not.toContain("p_scope_type = 'admin'");
    expect(publish).not.toContain("scope_type = 'admin'");
    expect(publish).not.toContain("'B'");
    expect(publish).toContain("IF COALESCE(p_variant, '') <> 'A' THEN");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamptz) TO service_role;");
  });

  it("keeps the anon-execute safety check", () => {
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
  });
});

describe("frontend, nlc-data and scripts", () => {
  it("none of the removed RPCs is reachable", () => {
    for (const name of [...DROPPED, "publish_daily_quiz"]) {
      expect(edge, name).not.toContain(`"${name}"`);
      expect(db, name).not.toContain(`"${name}"`);
      expect(admin, name).not.toContain(name);
    }
  });

  it("staging sample data no longer copies or resets the dropped table", () => {
    expect(sampleData).not.toContain("quiz_publication_schedules");
  });
});
