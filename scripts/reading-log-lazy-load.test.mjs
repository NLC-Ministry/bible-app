import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// #474 打卡紀錄按需載入：開機只抓還能打卡的計畫＋無歸屬紀錄，已關閉計畫用摘要，
// 點進去才抓逐筆。行為測試在 reading-log-scope.test.mjs；這裡鎖住各檔案的接線。
const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const db = read("js/db.js");
const utils = read("js/utils.js");
const bible = read("js/modules/bible.js");
const plan = read("js/modules/plan.js");
const auth = read("js/auth.js");
const nlcData = read("supabase/functions/nlc-data/index.ts");
const migrationFile = readdirSync(join(root, "supabase/migrations")).find(name => name.endsWith("_my_reading_log_digest.sql"));
const migration = migrationFile ? read(`supabase/migrations/${migrationFile}`) : "";

const between = (source, start, end) => {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
};

describe("#474 開機載入", () => {
  // 套用段在 #630 抽成 _applyLoadedUserData（開機快照共用），緊接在 loadUserData 前面
  const loadUserData = between(db, "async _applyLoadedUserData(", "async loadOrgStructure()");

  it("第一段的 batch 不再平行抓 reading_logs；拿到計畫清單後才查開機範圍", () => {
    const firstPhase = between(loadUserData, "const [[globalPlansResult, profileResult, firstPlansResult], highlightsResult]", "]);");
    expect(firstPhase).not.toContain("reading_logs");
    expect(firstPhase).not.toContain("readingLogRepository");
    const bootCall = loadUserData.indexOf("await this.loadBootReadingLogs(");
    expect(bootCall).toBeGreaterThan(loadUserData.indexOf("const [[globalPlansResult, profileResult, firstPlansResult], highlightsResult]"));
    expect(loadUserData).toContain("plansResult.data || []");
  });

  it("計畫清單失敗就不查紀錄、保留既有紀錄", () => {
    expect(loadUserData).toContain("const bootLogs = skipReadingLogs || plansResult.error");
    expect(loadUserData).toContain("const logsLoaded = Boolean(bootLogs && !logsResult.error);");
    expect(loadUserData).toContain("if (logsLoaded) {");
  });

  it("開機查詢只帶還能打卡的計畫＋無歸屬紀錄，摘要 RPC 拿已關閉計畫", () => {
    const boot = between(db, "  loadBootReadingLogs(user, enrollments, globalPlanRows) {", "  async fetchReadingLogDigest(");
    expect(boot).toContain("applyOpenReadingLogFilter(query, openPlanIds)");
    expect(boot).toContain("cacheKey: readingLogOpenCacheKey(user.id)");
    expect(boot).toContain("fetchDigest: closedPlanIds => this.fetchReadingLogDigest(closedPlanIds)");
    expect(boot).toContain('query.in("plan_id", closedPlanIds)');
    // SWR 先到的資料不能讓其他計畫的紀錄暫時消失
    expect(boot).toContain("keepOtherPlans: true");
    expect(db).toContain("state.supabase.rpc(READING_LOG_DIGEST_RPC, { p_plan_ids: planIds })");
  });

  it("逐筆紀錄還沒載入的已關閉計畫，遍數確認用摘要", () => {
    expect(loadUserData).toContain("isPlanReadingLogsLoaded(state.readingLogScope, dbPlan.id)");
    expect(loadUserData).toContain("digestRoundLogs(state.readingLogDigest, dbPlan.id)");
  });

  it("重新整理時保留按需載入過、仍是已關閉的計畫", () => {
    expect(loadUserData).toContain("getLazilyLoadedPlanIds(state.readingLogScope)");
    expect(loadUserData).toContain(".filter(id => bootLogs.closedPlanIds.includes(id))");
  });

  it("網路失敗只拿到快取時，摘要從上次的離線快照接手", () => {
    expect(loadUserData).toContain("const restored = this.restoreReadingLogOfflineSnapshot();");
  });
});

describe("#474 進度、獎章、連續天數", () => {
  const progress = between(utils, "function calculateAllPlansProgress()", "\nfunction getHiddenPlanKeys()");

  it("calculateAllPlansProgress 對未載入的計畫用摘要比對（獎章、鐵獎、已結束清單）", () => {
    expect(progress).toContain("const usesDigest = !isPlanReadingLogsLoaded(state.readingLogScope, plan.id);");
    expect(progress).toContain("digestRoundLogs(state.readingLogDigest, plan.id)");
    expect(progress).toContain("digestChapterKeys(state.readingLogDigest, plan.id).forEach(key => logSet.add(`${plan.id}_${key}`))");
    expect(progress.indexOf("digestChapterKeys")).toBeLessThan(progress.indexOf("let completed = 0;"));
  });

  it("首頁連續天數合併摘要的打卡日期", () => {
    const streak = between(db, "  calculateStreak() {", "  saveLocalUserStats() {");
    expect(streak).toContain("collectReadDateKeys(state.readingLogs, state.readingLogDigest, toLocalYYYYMMDD)");
  });
});

describe("#474 按需載入與已讀標記", () => {
  it("進入計畫詳情／群組（統計、排行）時才抓那個計畫的逐筆紀錄，抓到後重畫", () => {
    const setPlanState = between(plan, "async function setPlanState(newState) {", "\nasync function showDiscoverPlans()");
    expect(setPlanState).toContain("requestActivePlanReadingLogs();");
    const request = between(plan, "function requestActivePlanReadingLogs() {", "\nasync function setPlanState(");
    expect(request).toContain("db.ensurePlanReadingLogs(plan)");
    expect(request).toContain("state.activePlan !== plan");
    expect(request).toContain("return renderPlanView();");
  });

  it("按需載入：合併該計畫紀錄、標成已載入、照實際日期重排日程後重算", () => {
    const apply = between(db, "  applyPlanReadingLogs(planId, rows) {", "  saveReadingLogOfflineSnapshot() {");
    expect(apply).toContain("mergePlanReadingLogs(state.readingLogs, rows, planId)");
    expect(apply).toContain("addLoadedPlanToScope(state.readingLogScope, planId)");
    expect(apply).toContain("rebuildPlanSchedule(plan)");
    expect(apply.indexOf("rebuildPlanSchedule(plan)")).toBeLessThan(apply.indexOf("calculateAllPlansProgress()"));
    const ensure = between(db, "  ensurePlanReadingLogs(plan) {", "  applyPlanReadingLogs(planId, rows) {");
    expect(ensure).toContain("state.offlineMode");
    expect(ensure).toContain("cacheKey: readingLogPlanCacheKey(user.id, id)");
  });

  it("讀經器已讀標記只看還能打卡的計畫＋無歸屬紀錄", () => {
    expect(bible).toContain("isLogInOpenScope(state.readingLogScope, l)");
  });

  it("寫入時開機範圍與該計畫的快取都失效", () => {
    const logChapterRead = between(db, "async logChapterRead(", "async syncProfileStatsToSupabase");
    expect(logChapterRead).toContain("readingLogCacheKeys(user.id, planId)");
    expect(logChapterRead).not.toContain("`reading_logs:${user.id}`");
    expect(read("js/pwa/PwaCoordinator.js")).toContain("readingLogCacheKeys(user.id, payload.planId)");
    expect(plan).toContain("invalidate: readingLogCacheKeys(user.id, planId)");
  });

  it("退出計畫、重置進度時一併移除那個計畫的摘要", () => {
    expect(db).toContain("state.readingLogDigest = removePlanFromDigest(state.readingLogDigest, planId);");
    expect(plan).toContain("state.readingLogDigest = removePlanFromDigest(state.readingLogDigest, planId);");
  });
});

describe("#474 離線快照", () => {
  it("只存還能打卡的計畫紀錄，另外存摘要與 scope；還原時一起還原", () => {
    const save = between(db, "  saveReadingLogOfflineSnapshot() {", "  restoreReadingLogOfflineSnapshot() {");
    expect(save).toContain('safeStorageSet("reading_logs", filterOpenScopeLogs(state.readingLogs, scope), 300);');
    expect(save).toContain('safeStorageSet("reading_log_digest", state.readingLogDigest, 300);');
    const offline = between(db, "  loadOfflineSnapshot() {", "  // Initialize Supabase Connection");
    expect(offline).toContain("this.restoreReadingLogOfflineSnapshot()");
    expect(offline).toContain("state.readingLogDigest = digest;");
  });

  it("登出清掉摘要與 scope", () => {
    expect(auth).toContain('localStorage.removeItem("reading_log_digest");');
    expect(auth).toContain('localStorage.removeItem("reading_log_scope");');
    expect(auth).toContain("state.readingLogDigest = null;");
  });
});

describe("#474 摘要 RPC", () => {
  it("migration 只看呼叫者自己、指定的計畫，日期用台北時間", () => {
    expect(migrationFile).toBeTruthy();
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_my_reading_log_digest(p_plan_ids uuid[], p_actor_id uuid DEFAULT NULL::uuid)");
    expect(migration).toContain("p_actor_id IS NOT NULL");
    expect(migration).toContain("log.user_id = p_actor_id");
    expect(migration).toContain("log.plan_id = ANY(COALESCE(p_plan_ids, ARRAY[]::uuid[]))");
    expect(migration).toContain("AT TIME ZONE 'Asia/Taipei'");
    expect(migration).toContain("SET search_path TO ''");
  });

  it("只授權 service_role", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_my_reading_log_digest(uuid[], uuid) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_my_reading_log_digest(uuid[], uuid) TO service_role;");
    expect(migration).not.toMatch(/GRANT[^;]*get_my_reading_log_digest[^;]*\b(anon|authenticated)\b/);
  });

  it("nlc-data 開放這支 RPC 並注入 p_actor_id", () => {
    const set = between(nlcData, "const READING_STATS_RPC_FUNCTIONS = new Set([", "]);");
    expect(set).toContain('"get_my_reading_log_digest"');
    expect(nlcData).toContain("|| READING_STATS_RPC_FUNCTIONS.has(functionName)");
    expect(nlcData).toContain("rpcArgs = { ...(body.args || {}), p_actor_id: profile.id };");
  });
});
