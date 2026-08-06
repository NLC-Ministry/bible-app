import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRetiredPlanRequest } from "./retired-resources.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const READ_TABLES = new Set([
  "great_regions",
  "pastoral_zones",
  "small_groups",
  "global_plans",
  "church_announcements",
  "profiles",
  "reading_plans",
  "reading_logs",
  "devotional_notes",
  "devotional_likes",
  "devotional_comments",
  "verse_likes",
  "profile_identity_overview",
  "member_reading_summary",
  "view_pastoral_zone_stats",
  "view_small_group_stats",
  "care_reminders",
  "app_feature_settings",
  "role_definitions",
  "highlights"
]);
const USER_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes", "highlights"]);
const ADMIN_WRITE_TABLES = new Set(["great_regions", "pastoral_zones", "small_groups", "global_plans", "church_announcements", "profiles", "app_feature_settings"]);
const OWN_WRITE_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments", "care_reminders", "highlights"]);
const TEAM_RPC_FUNCTIONS = new Set([
  "get_my_reading_team",
  "get_reading_team_registration_overview",
  "get_reading_team_statistics",
  "get_reading_team_leaderboards",
  "get_pastoral_zone_leaderboard",
  "get_personal_plan_ranking_summary",
  "create_reading_team",
  "join_reading_team_by_code",
  "get_reading_team_carryover_offer",
  "carry_reading_teams_to_stage",
  "leave_reading_team",
  "remove_reading_team_member",
  "disband_reading_team",
  "rename_reading_team",
  "send_reading_team_reminder",
  "get_unjoined_plan_members",
  "send_plan_join_invitation"
]);
const PLAN_MANAGEMENT_RPC_FUNCTIONS = new Set([
  "get_reading_team_registration_overview",
  "get_unjoined_plan_members",
  "send_plan_join_invitation"
]);
const ADMIN_RPC_FUNCTIONS = new Set([
  "get_admin_registration_statistics"
]);
const PROFILE_SELECT = "id, name, email, avatar_url, great_region, pastoral_zone, small_group, role, role_id, is_demo, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments, role_definition:role_definitions!profiles_role_definition_fkey(id, code, label, sort_order, is_assignable, can_manage_plans, can_manage_permissions, scope_type)";
const RPC_FUNCTIONS = new Set([
  "increment_likes",
  "decrement_likes",
  "publish_global_plan_rules",
  ...TEAM_RPC_FUNCTIONS,
  ...ADMIN_RPC_FUNCTIONS
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

function parseJwt(token: string) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((char) => "%" + ("00" + char.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

const PROFILE_CACHE = new Map<string, { profile: any; timestamp: number }>();
const PROFILE_CACHE_TTL_MS = 15000; // 15 seconds warm Edge Function memory cache

async function fetchProfileData(supabaseAdmin: any, profileId: string) {
  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .eq("id", profileId)
      .single();
    if (!profileError && profile) return profile;
  } catch (err) {
    console.warn("PROFILE_SELECT join failed; falling back to direct profiles query:", err);
  }

  const { data: basicProfile, error: basicError } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, avatar_url, great_region, pastoral_zone, small_group, role, role_id, is_demo, is_active, managed_regions, managed_zones, managed_groups, member_context_synced_at, member_context_sync_attempted_at, member_context_sync_status, member_context_sync_error, member_context_leadership_display_label, member_context_leadership_primary_assignment_id, member_context_leadership_assignments")
    .eq("id", profileId)
    .single();
  if (basicError) throw basicError;
  return basicProfile;
}

async function resolveProfile(supabaseAdmin: any, accessToken: string) {
  const cached = PROFILE_CACHE.get(accessToken);
  const now = Date.now();
  if (cached && (now - cached.timestamp < PROFILE_CACHE_TTL_MS)) {
    return cached.profile;
  }

  const payload = parseJwt(accessToken);
  const expectedLogtoIssuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
  const tokenIssuer = trimSlash(String(payload?.iss || ""));
  const isLogtoJwt = Boolean(payload?.sub && tokenIssuer === expectedLogtoIssuer);

  // Logto is the production login method. Do not send its JWT to Supabase Auth
  // first: that request must fail before fallback and adds one remote round trip
  // to every nlc-data call. Non-Logto tokens still use Supabase verification.
  if (!isLogtoJwt) {
    try {
      const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(accessToken);
      if (user && !authErr) {
        const profile = await fetchProfileData(supabaseAdmin, user.id);
        if (profile) {
          PROFILE_CACHE.set(accessToken, { profile, timestamp: Date.now() });
          return profile;
        }
      }
    } catch (err) {
      console.log("Supabase JWT verification failed; checking Logto OIDC:", err);
    }
  }

  let sub: string | null = isLogtoJwt ? String(payload.sub) : null;
  if (!sub) {
    // Opaque Logto tokens cannot be decoded locally; resolve them through the
    // configured OIDC UserInfo endpoint.
    try {
      const discovery = await fetchJson(`${expectedLogtoIssuer}/.well-known/openid-configuration`);
      const userinfo = await fetchJson(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
      });
      sub = userinfo?.sub || null;
    } catch (err) {
      console.error("Failed to resolve profile from OIDC UserInfo fallback:", err);
    }
  }

  if (!sub) throw new Error("invalid_logto_token");

  const { data: identity, error: identityError } = await supabaseAdmin
    .from("user_identities")
    .select("profile_id")
    .eq("provider", "logto")
    .eq("provider_user_id", sub)
    .maybeSingle();
  if (identityError) throw identityError;
  if (!identity?.profile_id) throw new Error("profile_identity_not_found");

  const profile = await fetchProfileData(supabaseAdmin, identity.profile_id);
  PROFILE_CACHE.set(accessToken, { profile, timestamp: Date.now() });
  return profile;
}


async function isFeatureEnabled(supabaseAdmin: any, key: string) {
  const { data, error } = await supabaseAdmin
    .from("app_feature_settings")
    .select("enabled")
    .eq("key", key)
    .maybeSingle();
  if (error) return false;
  return data?.enabled === true;
}
function getProfileRoleCode(profile: any) {
  return profile?.role_definition?.code
    || profile?.role
    || "member";
}

function isAdmin(profile: any) {
  return getProfileRoleCode(profile) === "admin";
}

function hasWholeChurchPlanScope(profile: any) {
  return ["admin", "senior_pastor"].includes(getProfileRoleCode(profile));
}

function canManagePlans(profile: any) {
  return ["admin", "senior_pastor", "great_zone_leader", "zone_leader"].includes(getProfileRoleCode(profile));
}

function normalizeRows(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function forceUserPayload(table: string, payload: any, profileId: string, action?: string) {
  if (table === "profiles") {
    const rows = normalizeRows(payload).map(row => {
      const copy = { ...row };
      if (action === "update") {
        delete copy.id;
      } else {
        copy.id = copy.id || profileId;
      }
      return copy;
    });
    return Array.isArray(payload) ? rows : rows[0];
  }
  // issue_reports is included so a member's report is always attributed to the
  // authenticated caller (server-authoritative user_id), never a client-supplied one.
  const writeProtected = ["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments", "issue_reports", "highlights"];
  if (writeProtected.includes(table)) {
    const rows = normalizeRows(payload).map(row => {
      const copy = { ...row };
      if (action === "update") {
        delete copy.user_id;
      } else {
        copy.user_id = profileId;
      }
      return copy;
    });
    return Array.isArray(payload) ? rows : rows[0];
  }
  return payload;
}

function applyFilters(query: any, filters: any[] = []) {
  for (const filter of filters) {
    if (!filter || !filter.type || !filter.column) continue;
    if (filter.type === "eq") query = query.eq(filter.column, filter.value);
    else if (filter.type === "is") query = query.is(filter.column, filter.value);
    else if (filter.type === "in") query = query.in(filter.column, filter.value || []);
  }
  return query;
}

function valuesOverlap(left: unknown, right: unknown) {
  const leftValues = String(left || "").split(",").map(value => value.trim()).filter(Boolean);
  const rightValues = String(right || "").split(",").map(value => value.trim()).filter(Boolean);
  return leftValues.some(value => rightValues.includes(value));
}

async function getVisibleProfileIds(supabaseAdmin: any, profile: any) {
  if (hasWholeChurchPlanScope(profile)) return null;
  const splitScope = (value: unknown) => String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  const roleCode = getProfileRoleCode(profile);
  let query = supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("is_demo", false)
    .eq("is_active", true);

  if (roleCode === "great_zone_leader") {
    const regions = splitScope(profile.managed_regions || profile.great_region);
    if (!regions.length) return [profile.id];
    query = query.in("great_region", regions);
  } else if (roleCode === "zone_leader") {
    const zones = splitScope(profile.managed_zones || profile.pastoral_zone);
    if (!zones.length) return [profile.id];
    query = query.in("pastoral_zone", zones);
  } else if (roleCode === "group_leader") {
    const groups = splitScope(profile.managed_groups || profile.small_group);
    if (!groups.length) return [profile.id];
    query = query.in("small_group", groups);
  } else {
    return [profile.id];
  }

  const { data: profiles, error } = await query;
  if (error) throw error;
  return Array.from(new Set([profile.id, ...(profiles || []).map((candidate: any) => candidate.id)]));
}

async function applyForcedScope(query: any, table: string, action: string, profile: any, supabaseAdmin: any) {
  // Supabase query builders are PromiseLike. Returning one directly from this
  // async function would execute the query before order/limit/returning are
  // applied. Always wrap it in a plain object to prevent Promise assimilation.
  if (action === "insert" || action === "upsert") return { query };
  if (USER_TABLES.has(table)) {
    if (action !== "select") return { query: query.eq("user_id", profile.id) };
    const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
    return {
      query: visibleIds === null
        ? query
        : query.in("user_id", visibleIds.length ? visibleIds : [profile.id])
    };
  }
  if (table === "profiles" && !hasWholeChurchPlanScope(profile)) {
    const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
    return { query: query.in("id", visibleIds && visibleIds.length ? visibleIds : [profile.id]) };
  }
  if (table === "user_identities") return { query: query.eq("profile_id", profile.id) };
  if (table === "global_plans" && action === "select" && !canManagePlans(profile)) return { query: query.or("is_hidden.eq.false,plan_kind.eq.church_campaign_stage") };
  if (table === "church_announcements" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_published", true) };
  if (table === "care_reminders" && action === "select") return { query: query.eq("recipient_id", profile.id) };
  if (table === "care_reminders" && action === "update") return { query: query.eq("recipient_id", profile.id) };
  return { query };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "*";
  const localCorsHeaders = {
    ...corsHeaders,
    "Access-Control-Allow-Origin": origin
  };

  const requestStartedAt = performance.now();
  const jsonResponse = (body: unknown, status = 200) => {
    const serialized = JSON.stringify(body);
    return new Response(serialized, {
      status,
      headers: {
        ...localCorsHeaders,
        "Content-Length": String(new TextEncoder().encode(serialized).byteLength),
        "Server-Timing": `edge;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
        "Access-Control-Expose-Headers": "Content-Length, Server-Timing"
      }
    });
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: localCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "server_not_configured" }, 500);

    const authHeader = req.headers.get("Authorization") || "";
    const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) return jsonResponse({ error: "missing_authorization" }, 401);

    const body = await req.json().catch(() => ({}));
    const table = body.table;
    const action = body.action || "select";
    if (!["save_profile", "rpc", "send_care_reminder"].includes(action) && (!table || typeof table !== "string")) {
      return jsonResponse({ error: "missing_table" }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const profile = await resolveProfile(supabaseAdmin, accessToken);

    if (isRetiredPlanRequest(body)) {
      return jsonResponse({ error: "resource_not_found", resource: "reading_plan" }, 404);
    }

    if (action === "rpc") {
      const functionName = typeof body.function === "string" ? body.function : "";
      if (!RPC_FUNCTIONS.has(functionName)) return jsonResponse({ error: "forbidden_rpc" }, 403);
      if (functionName === "publish_global_plan_rules" && !isAdmin(profile)) {
        return jsonResponse({ error: "forbidden_rpc" }, 403);
      }
      if (PLAN_MANAGEMENT_RPC_FUNCTIONS.has(functionName) && !canManagePlans(profile)) {
        return jsonResponse({ error: "forbidden_rpc" }, 403);
      }
      if (ADMIN_RPC_FUNCTIONS.has(functionName) && !isAdmin(profile)) {
        return jsonResponse({ error: "forbidden_rpc" }, 403);
      }
      const rpcName = functionName;
      const rpcArgs = functionName === "publish_global_plan_rules"
        || TEAM_RPC_FUNCTIONS.has(functionName)
        || ADMIN_RPC_FUNCTIONS.has(functionName)
        ? { ...(body.args || {}), p_actor_id: profile.id }
        : (body.args || {});
      const { data, error } = await supabaseAdmin.rpc(rpcName, rpcArgs);
      if (error) return jsonResponse({ error: error.message, details: error }, 400);
      return jsonResponse({ data });
    }

    // ── send_care_reminder: server-side forced sender_id ──
    if (action === "send_care_reminder") {
      const p = body.payload || {};
      const validReasons = ["behind", "inactive", "care", "encouragement"];
      if (!p.recipient_id) return jsonResponse({ error: "missing_recipient_id" }, 400);
      if (!validReasons.includes(p.reason)) return jsonResponse({ error: "invalid_reason" }, 400);
      const msg = String(p.message || "").trim();
      if (!msg || msg.length > 300) return jsonResponse({ error: "invalid_message" }, 400);
      const pastoralRoles = ["admin", "senior_pastor", "great_zone_leader", "zone_leader", "group_leader"];
      if (!pastoralRoles.includes(getProfileRoleCode(profile)) || profile.id === p.recipient_id) {
        return jsonResponse({ error: "pastoral_reminder_scope_required" }, 403);
      }
      const { data: recipient, error: recipientError } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active, great_region, pastoral_zone, small_group")
        .eq("id", p.recipient_id)
        .maybeSingle();
      if (recipientError) return jsonResponse({ error: recipientError.message }, 400);
      if (!recipient || recipient.is_active === false) return jsonResponse({ error: "recipient_not_found" }, 404);

      const withinScope = hasWholeChurchPlanScope(profile)
        || (getProfileRoleCode(profile) === "great_zone_leader" && valuesOverlap(recipient.great_region, profile.managed_regions || profile.great_region))
        || (getProfileRoleCode(profile) === "zone_leader" && valuesOverlap(recipient.pastoral_zone, profile.managed_zones || profile.pastoral_zone))
        || (getProfileRoleCode(profile) === "group_leader"
          && valuesOverlap(recipient.pastoral_zone, profile.pastoral_zone)
          && valuesOverlap(recipient.small_group, profile.small_group));
      if (!withinScope) return jsonResponse({ error: "pastoral_reminder_scope_required" }, 403);
      const { error } = await supabaseAdmin
        .from("care_reminders")
        .insert({
          sender_id: profile.id,           // always the authenticated caller
          recipient_id: p.recipient_id,
          plan_key: String(p.plan_key || ""),
          reason: p.reason,
          message: msg,
          status: "unread",
          sent_on: new Date().toISOString().slice(0, 10)
        });
      if (error) return jsonResponse({ error: error.message, details: error, code: error.code }, 400);
      return jsonResponse({ data: null });
    }
    if (action === "save_profile") {
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const updatePayload = {
        name: payload.name ?? profile.name ?? "",
        updated_at: new Date().toISOString()
      };

      const { data: savedProfile, error: saveError } = await supabaseAdmin
         .from("profiles")
         .update(updatePayload)
         .eq("id", profile.id)
         .select(PROFILE_SELECT)
         .single();

      if (saveError) return jsonResponse({ error: saveError.message, details: saveError }, 400);
      if (!savedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);

      if (String((savedProfile as any).name || "") !== String(updatePayload.name || "")) {
        return jsonResponse({
          error: "profile_write_mismatch",
          mismatches: ["name"],
          expected: updatePayload,
          actual: savedProfile,
          project_url: supabaseUrl,
          profile_id: profile.id
        }, 500);
      }

      return jsonResponse({ data: savedProfile, profile: savedProfile, project_url: supabaseUrl, profile_id: profile.id });
    }

    // Any authenticated member may file an issue report (insert only). Reads and
    // deletes stay admin-only via canRead / canAdminWrite below. user_id is forced
    // to the caller in forceUserPayload so a member cannot spoof another user.
    if (["insert", "update", "upsert"].includes(action)
      && table === "profiles"
      && Object.prototype.hasOwnProperty.call(body.payload || {}, "role_id")) {
      return jsonResponse({ error: "role_assignment_managed_by_member_hub" }, 403);
    }
    const canReportInsert = action === "insert" && table === "issue_reports";
    const canReportOwnSelect = action === "select" && table === "issue_reports" && (
      isAdmin(profile) || (
        Array.isArray(body.filters) && body.filters.some((f: any) => f.column === "user_id" && f.value === profile.id)
      )
    );
    const canRead = action === "select" && (READ_TABLES.has(table) || canReportOwnSelect);
    const canOwnWrite = (["insert", "update", "delete", "upsert"].includes(action) && OWN_WRITE_TABLES.has(table)) || canReportInsert;
    const canAdminWrite = ["insert", "update", "delete", "upsert"].includes(action) && (ADMIN_WRITE_TABLES.has(table) || table === "issue_reports") && isAdmin(profile);
    if (!canRead && !canOwnWrite && !canAdminWrite) return jsonResponse({ error: "forbidden" }, 403);


    const devotionalTables = new Set(["devotional_notes", "devotional_likes", "devotional_comments"]);
    if (devotionalTables.has(table)
      && !(await isFeatureEnabled(supabaseAdmin, "pastoral_sharing_wall"))) {
      if (action === "select") return jsonResponse({ data: [] });
      return jsonResponse({ error: "feature_archived" }, 403);
    }
    let query: any;
    if (action === "select") {
      query = supabaseAdmin.from(table).select(body.select || "*");
    } else if (action === "insert") {
      query = supabaseAdmin.from(table).insert(forceUserPayload(table, body.payload, profile.id, action));
    } else if (action === "update") {
      query = supabaseAdmin.from(table).update(forceUserPayload(table, body.payload, profile.id, action));
    } else if (action === "delete") {
      query = supabaseAdmin.from(table).delete();
    } else if (action === "upsert") {
      query = supabaseAdmin.from(table).upsert(forceUserPayload(table, body.payload, profile.id, action), body.options || undefined);
    } else {
      return jsonResponse({ error: "unsupported_action" }, 400);
    }

    query = applyFilters(query, body.filters || []);
    if (body.or) query = query.or(body.or);
    ({ query } = await applyForcedScope(query, table, action, profile, supabaseAdmin));
    if (["insert", "update", "upsert"].includes(action) && body.select) query = query.select(body.select);
    if (body.order?.column) query = query.order(body.order.column, { ascending: body.order.ascending !== false });
    if (body.range && Number.isInteger(body.range.from) && Number.isInteger(body.range.to)) {
      const rangeFrom = Math.max(0, body.range.from);
      const rangeTo = Math.min(Math.max(rangeFrom, body.range.to), rangeFrom + 199);
      query = query.range(rangeFrom, rangeTo);
    }
    if (body.limit) query = query.limit(Math.min(200, Math.max(1, Number(body.limit) || 1)));
    if (body.returning === "single") query = query.single();
    else if (body.returning === "maybeSingle") query = query.maybeSingle();

    const { data, error } = await query;
    if (error) return jsonResponse({ error: error.message, details: error }, 400);

    let responseData = data;
    if (table === "profiles" && ["insert", "update", "upsert"].includes(action)) {
      const { data: verifiedProfile, error: verifyError } = await supabaseAdmin
        .from("profiles")
        .select(PROFILE_SELECT)
        .eq("id", profile.id)
        .maybeSingle();
      if (verifyError) return jsonResponse({ error: verifyError.message, details: verifyError }, 400);
      if (!verifiedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);
      responseData = verifiedProfile;
    }

    return jsonResponse({ data: responseData });
  } catch (err) {
    console.error("nlc-data failed:", err);
    return jsonResponse({ error: "nlc_data_failed", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
