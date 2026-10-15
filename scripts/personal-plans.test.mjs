import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  functionStatements,
  latestFunctionDefinition,
  migrationFiles,
  readMigration
} from "./migration-sql.mjs";
import { isRetiredPlanRequest } from "../supabase/functions/nlc-data/retired-resources.ts";
import { isRetiredPlanRecord } from "../js/production-cleanup.mjs";

// #473 個人計畫：後端規則、「不進排行榜／團隊／教會統計」的盤點，以及前端接線。
// 規則本身的行為測試在 js/data/personal-plans.test.mjs。
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const migrationFile = readdirSync(join(root, "supabase/migrations")).find(name => name.endsWith("_personal_reading_plans.sql"));
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";
const db = read("js/db.js");
const plan = read("js/modules/plan.js");
const html = read("index.html");

describe("#473 migration：欄位、約束、上限觸發器", () => {
  it("is_personal 明確標記，舊資料預設 false", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false");
  });

  it("個人計畫不能掛教會計畫", () => {
    expect(migration).toContain("CHECK (NOT is_personal OR (global_plan_id IS NULL AND preset_key IS NULL))");
  });

  it("每人最多 5 個進行中（end_date ≥ 台北今天），同一人寫入排隊", () => {
    const fn = latestFunctionDefinition("enforce_personal_plan_rules").text;
    expect(fn).toContain("(now() AT TIME ZONE 'Asia/Taipei')::DATE");
    expect(fn).toContain("plan.end_date >= taipei_today");
    expect(fn).toContain("IF active_count >= 5 THEN");
    expect(fn).toContain("RAISE EXCEPTION 'personal_plan_limit_reached'");
    expect(fn).toContain("pg_advisory_xact_lock(");
    // 已結束的計畫不佔名額，不會被擋
    expect(fn).toContain("IF NEW.end_date < taipei_today THEN\n    RETURN NEW;");
  });

  it("is_personal 建立後不能改；開始打卡後書卷與日期鎖住", () => {
    const fn = latestFunctionDefinition("enforce_personal_plan_rules").text;
    expect(fn).toContain("NEW.is_personal IS DISTINCT FROM OLD.is_personal");
    expect(fn).toContain("RAISE EXCEPTION 'personal_plan_locked_after_first_log'");
    expect(fn).toContain("NEW.target_books IS DISTINCT FROM OLD.target_books");
  });

  it("觸發器在 INSERT 與會影響規則的 UPDATE 都會跑", () => {
    expect(migration).toContain("BEFORE INSERT OR UPDATE OF is_personal, user_id, target_books, start_date, end_date, is_fixed");
    expect(migration).toContain("EXECUTE FUNCTION public.enforce_personal_plan_rules();");
  });

  it("新函式與重新定義的函式都有明確 REVOKE／GRANT", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.enforce_personal_plan_rules() FROM PUBLIC, anon, authenticated;");
    for (const name of PERSONAL_EXCLUDED) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO `));
    }
  });
});

// 每一支碰到 reading_plans／reading_logs 的 SQL 函式（最新定義）都要分類，說明個人計畫
// 為什麼不會被算進排行榜、團隊、教會統計。新增函式沒分類這個測試就會失敗。
const PERSONAL_EXCLUDED = [
  "admin_get_reading_activity",
  "admin_get_reading_activity_l7",
  "admin_get_reading_hour_heatmap",
  "_user_read_book_once",
  "get_plan_stats_roster",
  "get_admin_user_directory"
];
// 之後的 migration 新增、同樣明確排除個人計畫的（不在 #473 那份 migration 裡，所以不跟上面一起檢查授權）。
//   admin_api_reading_usage（#568）：每天章數和上面三支使用率函式同樣跳過個人計畫的打卡
const PERSONAL_EXCLUDED_LATER = [
  "admin_api_reading_usage"
];
// 依某個教會計畫（global_plan_id）查：個人計畫的 global_plan_id 一定是空的。
const SCOPED_TO_CHURCH_PLAN = [
  "daily_quiz_get_stats",
  "exam_get_stats",
  "get_admin_registration_statistics",
  "get_joined_plan_members",
  "get_unjoined_plan_members",
  "send_plan_join_invitation",
  "get_my_reading_team",
  "get_pastoral_zone_leaderboard",
  "get_personal_plan_ranking_summary",
  "get_reading_team_leaderboards",
  "get_reading_team_statistics",
  "carry_reading_teams_to_stage",
  "create_region_stage_cohort",
  "sync_church_campaign_stage_plans",
  "cleanup_removed_church_campaign_stages",
  "publish_global_plan_rules",
  "enforce_reading_log_stage_open",
  "enforce_reading_log_stage_progress_open",
  // 後台使用者名單（#550）：「是否加入」只看 global_plan_id／教會階段 preset_key 對得上所選計畫的
  "admin_api_directory_rows",
  // App 管理分頁（#551）與後台計畫總覽（#564）：報名只認 global_plan_id／preset_key 對得上的，另外明寫 NOT is_personal。
  // #564 起主體在 plan_progress_people，get_pastoral_overview 只是轉呼叫、不直接碰資料表
  "plan_progress_people"
];
// 只看呼叫者自己的資料，或只讀呼叫端給的計畫 id（來自已排除個人計畫的名單）。
const OWN_OR_GIVEN_PLANS = [
  "get_my_plan_chapter_total",
  "get_my_reading_log_digest",
  "get_plan_reading_log_digest",
  "enforce_reading_log_plan_owner",
  "enforce_personal_plan_rules"
];
// 後台客服查單一會友（#547）：只看 p_user_id 這一個人，個人計畫也要列出來——不是排行或統計。
const ONE_PERSON_SUPPORT_VIEW = [
  "admin_api_user_summary",
  "admin_api_user_timeline",
  "_admin_api_section_items"
];

function functionsTouchingReadingTables() {
  const names = new Set();
  for (const file of migrationFiles()) {
    for (const statement of functionStatements(readMigration(file))) names.add(statement.name);
  }
  return [...names].filter(name => {
    let entry;
    try { entry = latestFunctionDefinition(name); } catch { return false; }
    return /reading_plans|reading_logs/.test(entry.text);
  }).sort();
}

describe("#473 個人計畫不進排行榜、團隊、教會統計", () => {
  it("每支碰到 reading_plans／reading_logs 的函式都有分類", () => {
    const classified = new Set([...PERSONAL_EXCLUDED, ...PERSONAL_EXCLUDED_LATER, ...SCOPED_TO_CHURCH_PLAN, ...OWN_OR_GIVEN_PLANS, ...ONE_PERSON_SUPPORT_VIEW]);
    const unclassified = functionsTouchingReadingTables().filter(name => !classified.has(name));
    expect(unclassified).toEqual([]);
  });

  it.each(ONE_PERSON_SUPPORT_VIEW)("%s 只查 p_user_id 這一個人", name => {
    const text = latestFunctionDefinition(name).text;
    for (const table of ["reading_logs", "reading_plans"]) {
      if (!new RegExp(`FROM public\\.${table} AS (\\w+)`).test(text)) continue;
      const alias = text.match(new RegExp(`FROM public\\.${table} AS (\\w+)`))[1];
      expect(text).toContain(`${alias}.user_id = p_user_id`);
    }
  });

  it.each([...PERSONAL_EXCLUDED, ...PERSONAL_EXCLUDED_LATER])("%s 明確排除個人計畫", name => {
    expect(latestFunctionDefinition(name).text).toMatch(/is_personal/);
  });

  it.each(SCOPED_TO_CHURCH_PLAN)("%s 依教會計畫（global_plan_id）查", name => {
    expect(latestFunctionDefinition(name).text).toContain("global_plan_id");
  });

  it("全體打卡活躍度（DAU／熱力圖）跳過個人計畫的打卡", () => {
    for (const name of ["admin_get_reading_activity", "admin_get_reading_activity_l7", "admin_get_reading_hour_heatmap"]) {
      expect(latestFunctionDefinition(name).text)
        .toContain("AND NOT EXISTS (SELECT 1 FROM public.reading_plans rp WHERE rp.id = l.plan_id AND rp.is_personal)");
    }
  });

  it("統計名單用名稱比對計畫時，同名的個人計畫不會混進來", () => {
    const roster = latestFunctionDefinition("get_plan_stats_roster").text;
    const plansCte = roster.slice(roster.indexOf("plans AS ("), roster.indexOf("log_groups AS ("));
    expect(plansCte).toContain("AND NOT plan.is_personal");
    expect(plansCte).toContain("OR plan.name = ANY (p_plan_aliases)");
  });
});

describe("#473 退役計畫名單不擋個人計畫", () => {
  const retiredName = "第一季速讀：2026年7月~9月";

  it("nlc-data：個人計畫取了退役計畫的名字也能新增、改名", () => {
    expect(isRetiredPlanRequest({ table: "reading_plans", action: "insert", payload: { name: retiredName, is_personal: true } })).toBe(false);
    expect(isRetiredPlanRequest({
      table: "reading_plans",
      action: "update",
      payload: { name: retiredName, is_personal: true },
      filters: [{ type: "eq", column: "id", value: "11111111-1111-1111-1111-111111111111" }]
    })).toBe(false);
  });

  it("nlc-data：不是個人計畫的退役名稱照樣擋", () => {
    expect(isRetiredPlanRequest({ table: "reading_plans", action: "insert", payload: { name: retiredName } })).toBe(true);
  });

  it("前端本機清理：個人計畫不因名稱被當成退役計畫刪掉", () => {
    expect(isRetiredPlanRecord({ id: "p1", presetKey: "p1", name: retiredName, isPersonal: true })).toBe(false);
    expect(isRetiredPlanRecord({ id: "p1", name: retiredName })).toBe(true);
  });

  it("改名的 payload 帶著 is_personal，nlc-data 才認得出是個人計畫", () => {
    expect(db).toContain("const payload = { ...fields, is_personal: true };");
  });
});

describe("#473 前端接線", () => {
  it("開機查 is_personal；欄位不存在（migration 還沒上）時退回原本的查詢", () => {
    expect(db).toContain('from("reading_plans").select(`${OWN_READING_PLAN_COLUMNS}, is_personal`)');
    expect(db).toContain("isMissingPersonalPlanColumn(firstPlansResult.error)");
    expect(db).toContain('await state.supabase.from("reading_plans").select(OWN_READING_PLAN_COLUMNS)');
  });

  it("個人計畫只看 is_personal：key 用自己的 id，不拿名稱去對應教會計畫", () => {
    expect(db).toContain("const isPersonal = dbPlan.is_personal === true;");
    expect(db).toMatch(/const key = isPersonal\s+\? dbPlan\.id/);
    expect(db).toMatch(/const linkedGlobalPlan = isPersonal\s+\? null/);
    expect(db).toContain("planObj.isPersonal = isPersonal;");
  });

  it("排行、團隊 RPC 對個人計畫不發送", () => {
    const fn = db.slice(db.indexOf("  _readingTeamPlanId(plan) {"), db.indexOf("  _readingTeamPlanId(plan) {") + 300);
    expect(fn).toContain("if (isPersonalPlan(plan)) return null;");
    expect(read("js/modules/team-registration.js")).toContain("if (plan.isPersonal === true) return false;");
  });

  it("計畫詳情：個人計畫藏起團體統計與排名，只留個人統計", () => {
    expect(plan).toContain("forceHidden(statsTab, isPersonal);");
    expect(plan).toContain("if (rankingTab) forceHidden(rankingTab, isPersonal);");
    expect(plan).toContain("if (isPersonalPlan(state.activePlan)) target = GROUP_SUBVIEW.PERSONAL;");
  });

  it("入口：狀態列「已結束」右邊的圓形＋，達上限時說明原因", () => {
    const toolbar = html.slice(html.indexOf('<div class="plan-list-toolbar">'), html.indexOf('id="plan-search-panel"'));
    expect(toolbar.indexOf('data-filter="completed"')).toBeLessThan(toolbar.indexOf('id="btn-add-personal-plan"'));
    expect(toolbar).toMatch(/id="btn-add-personal-plan"[^>]*aria-label="新增個人計畫"/);
    expect(toolbar).toContain('data-icon="plus"');
    expect(plan).toContain('button.setAttribute("aria-disabled", full ? "true" : "false");');
    expect(plan).toContain("showToast(PERSONAL_PLAN_LIMIT_MESSAGE);");
  });

  it("選單：個人計畫可以編輯，已結束也能刪除", () => {
    expect(html).toContain('id="edit-personal-plan-btn"');
    expect(plan).toContain('deleteBtn.style.display = expired && !personal ? "none" : "";');
    expect(plan).toContain("await deletePersonalPlanWithConfirm(state.activePlan);");
  });
});
