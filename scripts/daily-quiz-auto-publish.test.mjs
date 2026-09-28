import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #306（小測驗 Q1，屬於 #305）：每天 00:00 自動發佈、AI 提前一天出題、
// 發佈只剩系統管理員、拿掉「僅系統管理員（測試用）」範圍。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20260928064718_daily_quiz_auto_publish.sql");
const admin = read("js/modules/admin.js");
const db = read("js/db.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");

const fnBody = name => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const bodyStart = migration.indexOf("AS $", start);
  const delimiter = migration.slice(bodyStart + 3, migration.indexOf("\n", bodyStart)).trim();
  return migration.slice(start, migration.indexOf(`${delimiter};`, bodyStart + 3 + delimiter.length));
};

describe("tables", () => {
  it("one rule per plan, attributed to the admin who turned it on", () => {
    expect(migration).toContain("global_plan_id UUID PRIMARY KEY REFERENCES public.global_plans(id) ON DELETE CASCADE,");
    expect(migration).toContain("enabled_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,");
  });

  it("per-day overrides (skip / custom quiz) keyed by plan and date", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.quiz_daily_overrides (");
    expect(migration).toContain("PRIMARY KEY (global_plan_id, quiz_date)");
  });

  it("both tables are only reachable through the RPCs", () => {
    expect(migration).toContain("REVOKE ALL ON public.quiz_auto_publish_rules FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("REVOKE ALL ON public.quiz_daily_overrides FROM PUBLIC, anon, authenticated;");
  });
});

describe("auto publish", () => {
  const auto = () => fnBody("run_daily_quiz_auto_publish");

  it("publishes today's A version to all groups, closing at 23:59:59 Taipei", () => {
    expect(auto()).toContain("today DATE := (p_now AT TIME ZONE 'Asia/Taipei')::date;");
    expect(auto()).toContain("+ TIME '23:59:59') AT TIME ZONE 'Asia/Taipei')");
    expect(auto()).toContain("p_scope_type := 'all',");
    expect(auto()).toContain("p_variant := 'A',");
    expect(auto()).toContain("p_actor_id := rule.enabled_by,");
  });

  it("only for enabled rules on plans running today", () => {
    expect(auto()).toContain("WHERE r.enabled AND gp.start_date <= today AND gp.end_date >= today");
  });

  it("skips days marked 這天不發, days without a ready quiz, and already-published days (idempotent)", () => {
    expect(auto()).toContain("AND o.quiz_date = today AND o.skip) THEN");
    expect(auto()).toContain("'status', 'no_quiz'");
    expect(auto()).toContain("IF published_groups >= group_total THEN");
  });

  it("runs from the existing 5-minute sweep without breaking scheduled publishes if it fails", () => {
    const sweep = fnBody("run_daily_quiz_schedule_sweep");
    expect(sweep).toContain("auto_result := public.run_daily_quiz_auto_publish();");
    expect(sweep).toContain("auto_result := jsonb_build_object('error', SQLERRM);");
  });

  it("is service_role only", () => {
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.run_daily_quiz_auto_publish(timestamptz) TO service_role;");
  });
});

describe("publishing is admin-only; the admin test scope is gone", () => {
  it("publish_daily_quiz and schedule_daily_quiz_publish reject non-admins and scope 'admin'", () => {
    for (const name of ["publish_daily_quiz", "schedule_daily_quiz_publish"]) {
      const body = fnBody(name);
      expect(body, name).toContain("IF actor_role IS DISTINCT FROM 'admin' THEN\n    RAISE EXCEPTION 'quiz_publish_admin_only';");
      expect(body, name).toContain("IF COALESCE(p_scope_type, '') NOT IN ('group', 'zone', 'region', 'all') THEN");
    }
  });

  it("the old 7-argument publish_daily_quiz overload is dropped", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.publish_daily_quiz(uuid, date, text, text, text, jsonb, uuid);");
  });

  it("rule get/set are admin-only", () => {
    for (const name of ["get_daily_quiz_auto_publish_rule", "set_daily_quiz_auto_publish_rule"]) {
      expect(fnBody(name), name).toContain("IS DISTINCT FROM 'admin' THEN\n    RAISE EXCEPTION 'quiz_publish_admin_only';");
    }
  });
});

describe("AI generates a day ahead", () => {
  it("asks for tomorrow's A version only, and the 20:00 run only retries failures", () => {
    const invoke = fnBody("invoke_daily_church_quiz_generation");
    expect(invoke).toContain("target_date DATE := ((now() AT TIME ZONE 'Asia/Taipei')::date + 1);");
    expect(invoke).toContain("'variants', jsonb_build_array('A'),");
    expect(invoke).toContain("'retryExisting', p_retry");
  });

  it("cron moves to 12:00 and adds a 20:00 retry, only where the generation job already exists (production)", () => {
    expect(migration).toContain("IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-daily-church-quizzes') THEN");
    expect(migration).toContain("PERFORM cron.schedule('generate-daily-church-quizzes', '0 4 * * *',");
    expect(migration).toContain("PERFORM cron.schedule('retry-daily-church-quizzes', '0 12 * * *',");
  });
});

describe("frontend", () => {
  it("leaders only see stats; admins get the auto-publish switch", () => {
    expect(admin).toContain("const canPublish = typeof getUserRoleCode === 'function' && getUserRoleCode(state.currentUser) === 'admin';");
    // #307 起是「日曆／規則設定／統計」三個分頁；非系統管理員固定在統計
    expect(admin).toContain("const tab = canPublish\n    ? (ADMIN_QUIZ_TABS.some(item => item.key === root.dataset.quizActiveTab) ? root.dataset.quizActiveTab : 'calendar')\n    : 'stats';");
    expect(admin).toContain("void bindAdminQuizAutoRule(root);");
    expect(admin).toContain("每天 00:00 自動發給全部小組、23:59 截止");
  });

  it("db.js and nlc-data expose the rule RPCs", () => {
    expect(db).toContain('this._callQuizRpc("get_daily_quiz_auto_publish_rule"');
    expect(db).toContain('this._callQuizRpc("set_daily_quiz_auto_publish_rule"');
    expect(db).toContain('quiz_publish_admin_only: "只有系統管理員可以發佈小測驗。"');
    expect(nlcData).toContain('"get_daily_quiz_auto_publish_rule",');
    expect(nlcData).toContain('"set_daily_quiz_auto_publish_rule"');
  });
});
