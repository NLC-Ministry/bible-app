import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 0214：正式環境有 24 個函式可以被 anon 直接呼叫，其中 schedule_announcement
// 沒有呼叫者檢查，任何人都能發布全教會公告。根因是 default privileges 會把
// 新函式直接授權給 anon／authenticated，`REVOKE ... FROM PUBLIC` 收不回來。
const migration = readFileSync(
  new URL("../supabase/migrations/0214_revoke_anon_function_execute.sql", import.meta.url),
  "utf8"
);

// 沒有呼叫者檢查、只給內部用：只留 service_role
const SERVICE_ROLE_ONLY = [
  "schedule_announcement(text, text, timestamp with time zone, uuid, timestamp with time zone, text, text)",
  "run_daily_quiz_schedule_sweep()",
  "_lightning_quiz_actor_is_admin(uuid)",
  "_lightning_quiz_answer_is_correct(text, jsonb, jsonb)",
  "_lightning_quiz_is_locked(uuid)",
  "_lightning_quiz_window_ended(date, time without time zone)",
  "_lightning_quiz_window_started(date, time without time zone)"
];

// 有 resolve_quiz_actor 檢查，或被 authenticated 的 RLS 規則用到：只收回 anon
const AUTHENTICATED_KEPT = [
  "profile_matches_announcement_scope(uuid, text, text)",
  "admin_clear_lightning_quiz_attempts(uuid, uuid)",
  "admin_delete_lightning_quiz_question(uuid, uuid)",
  "admin_get_lightning_quiz_leaderboard(uuid, integer, uuid)",
  "admin_get_lightning_quiz_results(uuid, uuid)",
  "admin_get_lightning_quiz_trend(date, date, uuid)",
  "admin_list_lightning_quiz_questions(date, date, uuid)",
  "admin_set_lightning_quiz_status(uuid, text, uuid)",
  "admin_upsert_lightning_quiz_question(uuid, date, time without time zone, time without time zone, text, jsonb, jsonb, uuid)",
  "cancel_daily_quiz_schedule(uuid, uuid)",
  "exam_save_pre_announcement(uuid, jsonb, boolean, uuid)",
  "get_my_lightning_quiz_history(date, date, uuid)",
  "get_todays_lightning_quiz(uuid)",
  "publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid, timestamp with time zone)",
  "schedule_daily_quiz_publish(uuid, date, text, text, text, jsonb, timestamp with time zone, timestamp with time zone, uuid)",
  "start_lightning_quiz_attempt(uuid, uuid)",
  "submit_lightning_quiz_attempt(uuid, jsonb, uuid)"
];

describe("0214: anon can no longer execute public functions", () => {
  it("covers all 24 functions that were anon-executable in production", () => {
    expect(SERVICE_ROLE_ONLY.length + AUTHENTICATED_KEPT.length).toBe(24);
  });

  it.each(SERVICE_ROLE_ONLY)("%s is service_role only", signature => {
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`);
    expect(migration).not.toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated`);
  });

  it.each(AUTHENTICATED_KEPT)("%s drops anon but keeps authenticated and service_role", signature => {
    expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon;`);
    expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated, service_role;`);
  });

  it("stops new functions from being granted to PUBLIC, anon, and authenticated by default", () => {
    expect(migration).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;/
    );
    expect(migration).toMatch(/ALTER DEFAULT PRIVILEGES FOR ROLE postgres\s+REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;/);
    // service_role 的預設授權不能被收回，nlc-data 需要它
    expect(migration).not.toMatch(/REVOKE EXECUTE ON FUNCTIONS FROM[^;]*service_role/);
  });

  it("fails the whole migration if any public function is still anon-executable", () => {
    expect(migration).toContain("has_function_privilege('anon', p.oid, 'EXECUTE')");
    expect(migration).toContain("RAISE EXCEPTION 'anon can still execute public functions: %'");
  });
});
