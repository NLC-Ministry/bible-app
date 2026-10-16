// #571 後台隊伍修正動作：移出成員（隊長只剩自己＝解散）、把人加進這隊、重算狀態。
// admin-api 的三個動作（能力 teams.write、參數檢查、錯誤對應）、異動歷程認得後台的函式、migration 的權限與檢查。
import { describe, expect, it, vi } from "vitest";
import { buildTeamDetail, buildTeamHistory, joinMethod } from "../supabase/functions/_shared/progress/team-report.mjs";
import { resolvePlanForReport } from "../supabase/functions/_shared/progress/plan-report.mjs";
import { ADMIN_ACTIONS, CAPABILITIES, capabilitiesForRole } from "../supabase/functions/admin-api/policy.ts";
import { AUDIT_ACTION_LABEL } from "../supabase/functions/admin-api/audit.ts";
import { handleAdminRequest } from "../supabase/functions/admin-api/handler.ts";
import { migrationFiles, readMigration } from "./migration-sql.mjs";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TEAM = "44444444-4444-4444-8444-444444444444";
const TEAM_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_CLIENT = "admin-spa-client";
const STAGE_ROW = {
  id: PLAN_ID, name: "第2階段｜約翰福音", plan_kind: "church_campaign_stage", rules: { presetKey: "church_stage_02" }, is_hidden: false,
  target_books: ["約翰福音"], start_date: "2026-11-01", end_date: "2026-11-21"
};
const FIX_ACTIONS = ["team_remove_member", "team_add_member", "team_recompute_status"];

function setupAdmin({ actorRole = "admin", results = {} } = {}) {
  const calls = [];
  const deps = {
    env: (key) => ({ ADMIN_API_ALLOWED_CLIENT_IDS: ADMIN_CLIENT })[key],
    verifyToken: vi.fn(async () => ({ ok: true, payload: { sub: "logto-sub-1", client_id: ADMIN_CLIENT } })),
    rpc: vi.fn(async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "admin_api_actor") return { data: { id: ADMIN_ID, role_code: actorRole, is_active: true }, error: null };
      if (fn === "admin_api_take_rate_limit") return { data: { allowed: true }, error: null };
      if (Object.prototype.hasOwnProperty.call(results, fn)) return results[fn];
      if (fn === "admin_api_team_info") return { data: { team_id: TEAM_ID, plan: STAGE_ROW }, error: null };
      if (fn === "admin_api_team_remove_member") return { data: { team_id: TEAM_ID, global_plan_id: PLAN_ID, removed_user_id: USER_ID, dissolved: false, member_count: 1, status: "forming" }, error: null };
      if (fn === "admin_api_team_add_member") return { data: { added: true, team_id: TEAM_ID, user_id: USER_ID, member_count: 3, status: "ready" }, error: null };
      if (fn === "admin_api_team_recompute_status") return { data: { team_id: TEAM_ID, member_count: 2, status_before: "ready", status: "forming", changed: true }, error: null };
      return { data: null, error: { message: `unexpected ${fn}` } };
    }),
    log: () => {},
    randomId: () => "generated-request-id"
  };
  return { deps, calls };
}
const post = (body) => new Request("https://example.supabase.co/functions/v1/admin-api", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://bible-speed-reading-admin.vercel.app",
    Authorization: "Bearer token-abc",
    "x-request-id": "req-from-client-1"
  },
  body: JSON.stringify(body)
});
const json = async (response) => ({ status: response.status, body: await response.json() });
const teamCalls = (calls) => calls.filter((call) => /^admin_api_team_/.test(call.fn));
const send = async (action, params, options) => {
  const { deps, calls } = setupAdmin(options);
  return { ...(await json(await handleAdminRequest(post({ action, params }), deps))), calls: teamCalls(calls) };
};

describe("admin-api team fixes", () => {
  it("need teams.write (only the system admin has it), use the write rate limit, and are in the audit vocabulary", () => {
    expect(CAPABILITIES).toContain("teams.write");
    expect(capabilitiesForRole("admin")).toContain("teams.write");
    expect(capabilitiesForRole("pastor")).toEqual([]);
    for (const name of FIX_ACTIONS) {
      expect(ADMIN_ACTIONS[name].capabilities, name).toEqual(["teams.write"]);
      expect(ADMIN_ACTIONS[name].rateLimit.bucket, name).toBe("write");
      expect(AUDIT_ACTION_LABEL[name], name).toBeTruthy();
    }
    for (const action of ["team.remove_member", "team.dissolve", "team.add_member", "team.recompute_status"]) {
      expect(AUDIT_ACTION_LABEL[action], action).toBeTruthy();
    }
  });

  it("移出：passes the team, the person and the optional reason; SQL does the checks and the audit", async () => {
    const res = await send("team_remove_member", { team_id: TEAM_ID, user_id: USER_ID, reason: "  重複入隊 " });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dissolved: false, member_count: 1 });
    expect(res.calls).toEqual([{ fn: "admin_api_team_remove_member", args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_team_id: TEAM_ID, p_user_id: USER_ID, p_reason: "重複入隊", p_request_id: "req-from-client-1"
    } }]);
    const noReason = await send("team_remove_member", { team_id: TEAM_ID, user_id: USER_ID });
    expect(noReason.calls[0].args.p_reason).toBeNull();
  });

  it("加人：derives the preset key from the team's plan (never the client's); a blocked add comes back as data", async () => {
    const res = await send("team_add_member", { team_id: TEAM_ID, user_id: USER_ID, p_preset_key: "forged" });
    expect(res.status).toBe(200);
    expect(res.calls.map((call) => call.fn)).toEqual(["admin_api_team_info", "admin_api_team_add_member"]);
    expect(res.calls[1].args).toEqual({
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_team_id: TEAM_ID, p_user_id: USER_ID, p_reason: null, p_request_id: "req-from-client-1",
      p_preset_key: resolvePlanForReport(STAGE_ROW).plan.presetKey
    });

    const blocked = { added: false, blocked: "already_in_other_team", other_team: { id: OTHER_TEAM, name: "南風隊" } };
    const other = await send("team_add_member", { team_id: TEAM_ID, user_id: USER_ID }, { results: { admin_api_team_add_member: { data: blocked, error: null } } });
    expect(other).toMatchObject({ status: 200, body: { data: blocked } });

    const gone = await send("team_add_member", { team_id: TEAM_ID, user_id: USER_ID }, { results: { admin_api_team_info: { data: null, error: null } } });
    expect(gone).toMatchObject({ status: 404, body: { error: "team_not_found" } });
    expect(gone.calls.map((call) => call.fn)).toEqual(["admin_api_team_info"]);
  });

  it("重算狀態：needs only the team", async () => {
    const res = await send("team_recompute_status", { team_id: TEAM_ID });
    expect(res).toMatchObject({ status: 200, body: { data: { changed: true, status: "forming" } } });
    expect(res.calls).toEqual([{ fn: "admin_api_team_recompute_status", args: {
      p_actor_id: ADMIN_ID, p_actor_role: "admin", p_team_id: TEAM_ID, p_reason: null, p_request_id: "req-from-client-1"
    } }]);
  });

  it("SQL's refusals become 400 with their code; a missing team 404; the role re-check 403", async () => {
    for (const code of ["team_stage_ended", "team_captain_has_members", "team_member_not_found"]) {
      const res = await send("team_remove_member", { team_id: TEAM_ID, user_id: USER_ID },
        { results: { admin_api_team_remove_member: { data: null, error: { code: "22023", message: code } } } });
      expect(res, code).toMatchObject({ status: 400, body: { error: code } });
    }
    for (const code of ["user_not_enrolled", "reading_team_full", "user_inactive", "already_in_team", "team_stage_ended", "plan_requires_pastoral_zone"]) {
      const res = await send("team_add_member", { team_id: TEAM_ID, user_id: USER_ID },
        { results: { admin_api_team_add_member: { data: null, error: { code: "22023", message: code } } } });
      expect(res, code).toMatchObject({ status: 400, body: { error: code } });
    }
    expect(await send("team_recompute_status", { team_id: TEAM_ID }, { results: { admin_api_team_recompute_status: { data: null, error: null } } }))
      .toMatchObject({ status: 404, body: { error: "team_not_found" } });
    expect(await send("team_recompute_status", { team_id: TEAM_ID }, { results: { admin_api_team_recompute_status: { data: null, error: { code: "42501", message: "forbidden" } } } }))
      .toMatchObject({ status: 403, body: { error: "forbidden" } });
  });

  it("bad ids or reasons never reach SQL; other roles are refused before SQL", async () => {
    const cases = [
      ["team_remove_member", { team_id: "nope", user_id: USER_ID }, "invalid_team_id"],
      ["team_remove_member", { team_id: TEAM_ID }, "invalid_user_id"],
      ["team_add_member", { team_id: TEAM_ID, user_id: "x" }, "invalid_user_id"],
      ["team_recompute_status", { team_id: TEAM_ID, reason: "字".repeat(201) }, "reason_too_long"],
      ["team_recompute_status", { team_id: TEAM_ID, reason: 3 }, "invalid_reason"]
    ];
    for (const [action, params, error] of cases) {
      const res = await send(action, params);
      expect(res, error).toMatchObject({ status: 400, body: { error } });
      expect(res.calls, error).toEqual([]);
    }
    for (const action of FIX_ACTIONS) {
      const res = await send(action, { team_id: TEAM_ID, user_id: USER_ID }, { actorRole: "pastor" });
      expect(res.status, action).toBe(403);
      expect(res.calls, action).toEqual([]);
    }
  });
});

describe("team report knows the console's fixes", () => {
  it("a member added in the console shows as 後台加入", () => {
    expect(joinMethod(["admin_api_team_add_member"])).toEqual({ key: "admin", label: "後台加入" });
  });

  it("history says the console did it (who is in the audit log)", () => {
    const history = buildTeamHistory({
      records_since: "2026-09-28T11:54:07Z",
      member_events: [
        { id: 3, at: "2026-11-05T00:00:00Z", event_type: "delete", user_id: "u1", user_name: "甲", member_role: "captain", txid: 21, functions: ["admin_api_team_remove_member"] },
        { id: 2, at: "2026-11-04T00:00:00Z", event_type: "delete", user_id: "u2", user_name: "乙", member_role: "member", txid: 20, functions: ["admin_api_team_remove_member"] },
        { id: 1, at: "2026-11-03T00:00:00Z", event_type: "insert", user_id: "u3", user_name: "丙", member_role: "member", txid: 19, functions: ["admin_api_team_add_member"] }
      ],
      team_events: [
        { id: 6, at: "2026-11-05T00:00:00Z", event_type: "delete", txid: 21, functions: ["admin_api_team_remove_member"] },
        { id: 5, at: "2026-11-02T00:00:00Z", event_type: "update", name_old: "晨光隊", name_new: "晨光隊", status_old: "ready", status_new: "forming", division_old: 3, division_new: 3, txid: 18, functions: ["admin_api_team_recompute_status"] }
      ]
    });
    const rows = history.events.map((event) => [event.text, event.actor]);
    const ADMIN = "管理員在後台修正（誰按的見稽核紀錄）";
    expect(rows).toContainEqual(["甲（隊長） 跟著隊伍解散移出", ADMIN]);
    expect(rows).toContainEqual(["隊伍被解散（移出唯一的隊長）", ADMIN]);
    expect(rows).toContainEqual(["乙 被移出", ADMIN]);
    expect(rows).toContainEqual(["丙 加入（後台加入）", "管理員在後台加入（誰加的見稽核紀錄）"]);
    expect(rows).toContainEqual(["狀態從「已滿」改成「招募中」", ADMIN]);
  });

  it("each failed check points to the console button, except moving the captain", () => {
    const row = {
      id: TEAM_ID, name: "晨光隊", global_plan_id: PLAN_ID, division: 3, status: "ready", captain_id: "u9", captain_name: "庚",
      carried_from_team_id: null, created_at: "2026-11-01T02:00:00Z", invite_code: "ABCDEF1234",
      members: [{ user_id: "u1", name: "甲", member_role: "member", joined_at: "2026-11-01T02:00:00Z", division: 3, global_plan_id: PLAN_ID, is_active: true, joined_via: null }],
      elsewhere: [], events_after_end: 0, last_event_at: null
    };
    const detail = buildTeamDetail({ resolved: resolvePlanForReport(STAGE_ROW), data: { today: "2026-11-11", team: row, people: [], next_stages: [] } });
    const fix = Object.fromEntries(detail.checks.map((check) => [check.id, check.fix]));
    expect(fix.status).toContain("重算狀態");
    expect(fix.enrolled).toContain("移出");
    expect(fix.captain).toContain("請工程協助");
    expect(JSON.stringify(detail.checks)).not.toContain("#571");
  });
});

describe("migration", () => {
  const file = migrationFiles().find((name) => name.endsWith("_admin_api_team_fixes.sql"));
  const sql = readMigration(file);
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  const fns = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]);
  const body = (fn) => {
    const start = code.indexOf(`FUNCTION public.${fn}(`);
    return code.slice(start, code.indexOf("$function$;", start));
  };
  const helpers = ["_admin_api_team_assert_editable", "_admin_api_team_sync_status"];
  const actions = ["admin_api_team_remove_member", "admin_api_team_add_member", "admin_api_team_recompute_status"];

  it("grants the three actions to service_role only; the helpers to nobody", () => {
    expect(fns).toEqual([...helpers, ...actions]);
    for (const fn of actions) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
    for (const fn of helpers) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
      expect(sql, fn).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`));
    }
  });

  it("each action re-checks the admin, locks the team, refuses ended stages before writing, and audits in the same function", () => {
    for (const fn of actions) {
      const text = body(fn);
      const order = ["PERFORM public.admin_api_assert_admin(p_actor_id);", "FOR UPDATE;", "PERFORM public._admin_api_team_assert_editable(v_team.global_plan_id);", "PERFORM audit.record('admin-api'"]
        .map((needle) => text.indexOf(needle));
      expect(order.every((index) => index >= 0), fn).toBe(true);
      expect([...order].sort((a, b) => a - b), fn).toEqual(order);
      const firstWrite = text.search(/\b(INSERT INTO|UPDATE|DELETE FROM) public\.|_admin_api_team_sync_status\(/);
      expect(firstWrite, fn).toBeGreaterThan(order[2]);
    }
    expect(body("_admin_api_team_assert_editable")).toContain("'church_campaign_stage', 'church_campaign_stage_cohort'");
    expect(code).not.toContain("allow_ended_edit");
  });

  it("移出 only lets the captain go when alone (the team is dissolved); 加人 blocks other teams, the unenrolled and full teams", () => {
    const remove = body("admin_api_team_remove_member");
    expect(remove).toContain("RAISE EXCEPTION 'team_captain_has_members'");
    expect(remove).toContain("DELETE FROM public.reading_teams WHERE id = v_team.id;");
    const add = body("admin_api_team_add_member");
    for (const needle of ["'already_in_other_team'", "'user_not_enrolled'", "'reading_team_full'", "'user_inactive'", "'already_in_team'", "NOT plan.is_personal",
      "public.campaign_stage_join_block_reason(v_team.global_plan_id, p_user_id)"]) {
      expect(add, needle).toContain(needle);
    }
    expect(add.indexOf("'already_in_other_team'")).toBeLessThan(add.indexOf("'user_not_enrolled'"));
    expect(add).toContain("'member')");
  });
});
