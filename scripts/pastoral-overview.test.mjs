// #551 App 管理分頁的統計 RPC get_pastoral_overview：範圍由 nlc-data 依登入者注入、
// 只給 service_role、範圍空的時候什麼都不回；前端的呼叫只送計畫。
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { latestFunctionDefinition } from "./migration-sql.mjs";
import { PASTORAL_OVERVIEW_RPC, buildPastoralOverviewArgs } from "../supabase/functions/nlc-data/plan-stats-scope.ts";
import {
  PASTORAL_OVERVIEW_RPC as CLIENT_RPC,
  fetchPastoralOverview,
  normalizePastoralOverview,
  pastoralPlanArgs
} from "../js/data/pastoral-overview.mjs";

const ACTOR = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const PLAN = "00000000-0000-0000-c026-000000000001";
const SIGNATURE = "public.get_pastoral_overview(uuid, text, boolean, uuid[], uuid)";
const INNER_SIGNATURE = "public.plan_progress_people(uuid, text, boolean, uuid[], uuid)";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("nlc-data injects the scope for get_pastoral_overview", () => {
  const forged = { p_whole_church: true, p_visible_ids: null, p_actor_id: OTHER };

  it("the client and the edge function call the same RPC", () => {
    expect(CLIENT_RPC).toBe(PASTORAL_OVERVIEW_RPC);
    expect(PASTORAL_OVERVIEW_RPC).toBe("get_pastoral_overview");
  });

  it("whole church only when getVisibleProfileIds says so; forged scope values are overwritten", () => {
    expect(buildPastoralOverviewArgs({ p_global_plan_id: PLAN, p_preset_key: "2026-Q4", ...forged }, [ACTOR, "u-1"], ACTOR)).toEqual({
      p_global_plan_id: PLAN,
      p_preset_key: "2026-Q4",
      p_whole_church: false,
      p_visible_ids: [ACTOR, "u-1"],
      p_actor_id: ACTOR
    });
    expect(buildPastoralOverviewArgs({ p_global_plan_id: PLAN }, null, ACTOR)).toEqual({
      p_global_plan_id: PLAN,
      p_preset_key: null,
      p_whole_church: true,
      p_visible_ids: null,
      p_actor_id: ACTOR
    });
    // 範圍空的：只剩本人（同其他計畫統計）
    expect(buildPastoralOverviewArgs({ p_global_plan_id: PLAN, ...forged }, [], ACTOR)).toMatchObject({
      p_whole_church: false,
      p_visible_ids: [ACTOR],
      p_actor_id: ACTOR
    });
  });

  it("only a uuid plan id and a short preset key get through", () => {
    expect(buildPastoralOverviewArgs({ p_global_plan_id: "x' OR 1=1", p_preset_key: "k".repeat(201) }, [ACTOR], ACTOR))
      .toMatchObject({ p_global_plan_id: null, p_preset_key: null });
    expect(buildPastoralOverviewArgs({ p_global_plan_id: 5, p_preset_key: "" }, [ACTOR], ACTOR))
      .toMatchObject({ p_global_plan_id: null, p_preset_key: null });
    expect(buildPastoralOverviewArgs(undefined, [ACTOR], ACTOR)).toMatchObject({ p_global_plan_id: null, p_preset_key: null });
  });

  it("index.ts gates it like the other plan-management RPCs and never spreads client args", () => {
    const nlcData = read("supabase/functions/nlc-data/index.ts");
    const managementSet = nlcData.slice(nlcData.indexOf("const PLAN_MANAGEMENT_RPC_FUNCTIONS = new Set(["), nlcData.indexOf("]);", nlcData.indexOf("const PLAN_MANAGEMENT_RPC_FUNCTIONS")));
    expect(managementSet).toContain("PASTORAL_OVERVIEW_RPC");
    expect(nlcData).toContain("if (PLAN_MANAGEMENT_RPC_FUNCTIONS.has(functionName) && !canManagePlans(profile)) {");
    expect(nlcData).toMatch(/const RPC_FUNCTIONS = new Set\(\[[\s\S]*PASTORAL_OVERVIEW_RPC,[\s\S]*\]\);/);
    const start = nlcData.indexOf("} else if (functionName === PASTORAL_OVERVIEW_RPC) {");
    expect(start).toBeGreaterThan(0);
    const branch = nlcData.slice(start, nlcData.indexOf("}", nlcData.indexOf("buildPastoralOverviewArgs", start)));
    expect(branch.match(/await getVisibleProfileIds\(supabaseAdmin, profile\)/g)).toHaveLength(1);
    expect(branch).toContain("buildPastoralOverviewArgs(body.args, visibleIds, profile.id)");
    expect(branch).not.toContain("...(body.args");
  });
});

// #564 起主體搬到 plan_progress_people（不授權任何角色），get_pastoral_overview 只是轉呼叫的包裝。
describe("get_pastoral_overview migration", () => {
  const fn = latestFunctionDefinition("plan_progress_people").text;
  const wrapper = latestFunctionDefinition("get_pastoral_overview");
  const file = read("supabase/migrations/20261013114704_admin_api_plan_progress.sql");

  it("the wrapper is SECURITY DEFINER with an empty search_path, only service_role can run it, and it passes every argument through", () => {
    expect(wrapper.file).toBe("20261013114704_admin_api_plan_progress.sql");
    expect(wrapper.text).toMatch(/SECURITY DEFINER\s+SET search_path TO ''/);
    expect(wrapper.text).toContain("SELECT public.plan_progress_people(p_global_plan_id, p_preset_key, p_whole_church, p_visible_ids, p_actor_id);");
    expect(file).toContain(`REVOKE ALL ON FUNCTION ${SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(file).toContain(`GRANT EXECUTE ON FUNCTION ${SIGNATURE} TO service_role;`);
    expect(file).not.toMatch(/GRANT[^;]*get_pastoral_overview[^;]*\b(anon|authenticated)\b/);
  });

  it("the inner function is granted to nobody, not even service_role (scope always comes from a wrapper)", () => {
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path TO ''/);
    expect(file).toContain(`REVOKE ALL ON FUNCTION ${INNER_SIGNATURE} FROM PUBLIC, anon, authenticated, service_role;`);
    expect(file).not.toMatch(/GRANT[^;]*plan_progress_people/);
  });

  it("returns an independent count for reconciliation (meta)", () => {
    expect(fn).toContain("'inScope', (SELECT COUNT(*)::int FROM roster WHERE EXISTS (SELECT 1 FROM global_plan))");
    expect(fn).toContain("'enrolled', (SELECT COUNT(*)::int FROM enrollment)");
  });

  it("fails closed: no actor, no plan, or no whole-church flag and no ids returns nobody", () => {
    expect(fn).toContain("p_actor_id IS NOT NULL\n      AND p_global_plan_id IS NOT NULL\n      AND (p_whole_church IS TRUE OR COALESCE(cardinality(p_visible_ids), 0) > 0)");
    expect(fn).toContain("(p_whole_church IS TRUE OR prof.id = ANY (p_visible_ids))");
    expect(fn).not.toMatch(/p_visible_ids IS NULL OR/);
    // 每一段資料都掛在範圍或計畫上
    expect(fn).toContain("WHERE (SELECT allowed FROM scope) AND gp.id = p_global_plan_id");
    expect(fn).toContain("plan.user_id IN (SELECT roster.id FROM roster)");
    expect(fn).toContain("member.user_id IN (SELECT roster.id FROM roster)");
  });

  it("counts only church enrollments of active accounts, never personal plans (#473)", () => {
    expect(fn).toContain("prof.is_active IS TRUE");
    expect(fn).toContain("AND NOT plan.is_personal");
    expect(fn).toContain("plan.global_plan_id = p_global_plan_id");
    // 打卡只算這筆報名、這個人、計畫書卷內，一章一遍只算一次（同前端 uniqueLogs）
    expect(fn).toContain("ON log.plan_id = enrollment.plan_id\n     AND log.user_id = enrollment.user_id");
    expect(fn).toContain("DISTINCT ON (enrollment.user_id, log.book, log.chapter, COALESCE(log.round, 1))");
    expect(fn).toContain("cardinality(enrollment.books) = 0 OR log.book = ANY (enrollment.books)");
  });

  it("returns facts only — no email, managed scopes or a second progress rule", () => {
    expect(fn).not.toMatch(/email|managed_|behind|ahead|expected/i);
    expect(fn).toContain("(now() AT TIME ZONE 'Asia/Taipei')::date AS today");
  });
});

describe("App side: fetchPastoralOverview", () => {
  it("sends the church plan uuid and preset key, nothing about scope", () => {
    expect(pastoralPlanArgs({ id: "enroll-1", globalPlanId: PLAN, presetKey: "2026-Q4" })).toEqual({
      p_global_plan_id: PLAN,
      p_preset_key: "2026-Q4"
    });
    expect(pastoralPlanArgs({ id: PLAN, preset_key: "" })).toEqual({ p_global_plan_id: PLAN, p_preset_key: null });
    expect(pastoralPlanArgs({ id: "not-a-uuid" })).toEqual({ p_global_plan_id: null, p_preset_key: null });
  });

  it("returns { today, people } and drops malformed rows", async () => {
    const client = { rpc: vi.fn(async () => ({ data: { today: "2026-10-13", people: [{ id: "a" }, null, { name: "no id" }] }, error: null })) };
    await expect(fetchPastoralOverview(client, { globalPlanId: PLAN })).resolves.toEqual({ today: "2026-10-13", people: [{ id: "a" }] });
    expect(client.rpc).toHaveBeenCalledWith("get_pastoral_overview", { p_global_plan_id: PLAN, p_preset_key: null });
    expect(Object.keys(client.rpc.mock.calls[0][1])).not.toContain("p_visible_ids");
  });

  it("reports errors instead of throwing, and does not call without a plan", async () => {
    const client = { rpc: vi.fn() };
    await expect(fetchPastoralOverview(client, { id: "x" })).resolves.toEqual({ error: "plan_required" });
    expect(client.rpc).not.toHaveBeenCalled();
    await expect(fetchPastoralOverview(null, { globalPlanId: PLAN })).resolves.toEqual({ error: "unavailable" });
    const failing = { rpc: vi.fn(async () => ({ data: null, error: { message: "forbidden_rpc" } })) };
    await expect(fetchPastoralOverview(failing, { globalPlanId: PLAN })).resolves.toEqual({ error: "forbidden_rpc" });
    const throwing = { rpc: vi.fn(async () => { throw new Error("offline"); }) };
    await expect(fetchPastoralOverview(throwing, { globalPlanId: PLAN })).resolves.toEqual({ error: "offline" });
    const odd = { rpc: vi.fn(async () => ({ data: [], error: null })) };
    await expect(fetchPastoralOverview(odd, { globalPlanId: PLAN })).resolves.toEqual({ error: "unexpected_shape" });
    expect(normalizePastoralOverview({ people: [] })).toEqual({ today: "", people: [] });
  });
});
