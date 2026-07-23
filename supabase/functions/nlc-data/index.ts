import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  "care_reminders"
]);
const USER_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes"]);
const ADMIN_WRITE_TABLES = new Set(["great_regions", "pastoral_zones", "small_groups", "global_plans", "church_announcements", "profiles"]);
const OWN_WRITE_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments", "care_reminders"]);
const TEAM_RPC_FUNCTIONS = new Set([
  "get_my_reading_team",
  "get_reading_team_statistics",
  "create_reading_team",
  "join_reading_team_by_code",
  "leave_reading_team",
  "disband_reading_team",
  "send_reading_team_reminder"
]);
const RPC_FUNCTIONS = new Set([
  "increment_likes",
  "decrement_likes",
  "publish_global_plan_rules",
  ...TEAM_RPC_FUNCTIONS
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

async function resolveProfile(supabaseAdmin: any, accessToken: string) {
  let sub: string | null = null;

  // Try decoding as JWT first (since Logto issues JWT access tokens for API resources)
  const payload = parseJwt(accessToken);
  if (payload && payload.sub) {
    sub = payload.sub;
  } else {
    // Fallback to UserInfo endpoint call (e.g. for opaque tokens)
    try {
      const issuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
      const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
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

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", identity.profile_id)
    .single();
  if (profileError) throw profileError;
  return profile;
}

function isAdmin(profile: any) {
  return profile?.role === "admin";
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
  const writeProtected = ["reading_plans", "reading_logs", "devotional_notes", "devotional_likes", "devotional_comments"];
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
  if (isAdmin(profile)) return null;
  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, great_region, pastoral_zone, small_group");
  if (error) throw error;
  return (profiles || []).filter((candidate: any) => {
    if (candidate.id === profile.id) return true;
    if (profile.role === "great_zone_leader") return valuesOverlap(candidate.great_region, profile.great_region);
    if (profile.role === "zone_leader") return valuesOverlap(candidate.pastoral_zone, profile.pastoral_zone);
    return valuesOverlap(candidate.pastoral_zone, profile.pastoral_zone)
      && valuesOverlap(candidate.small_group, profile.small_group);
  }).map((candidate: any) => candidate.id);
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
  if (table === "profiles" && !isAdmin(profile)) {
    const visibleIds = await getVisibleProfileIds(supabaseAdmin, profile);
    return { query: query.in("id", visibleIds && visibleIds.length ? visibleIds : [profile.id]) };
  }
  if (table === "user_identities") return { query: query.eq("profile_id", profile.id) };
  if (table === "global_plans" && action === "select" && !isAdmin(profile)) return { query: query.eq("is_hidden", false) };
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

  const jsonResponse = (body: unknown, status = 200) => {
    return new Response(JSON.stringify(body), { status, headers: localCorsHeaders });
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

    if (action === "rpc") {
      const functionName = typeof body.function === "string" ? body.function : "";
      if (!RPC_FUNCTIONS.has(functionName)) return jsonResponse({ error: "forbidden_rpc" }, 403);
      if (functionName === "publish_global_plan_rules" && !isAdmin(profile)) {
        return jsonResponse({ error: "forbidden_rpc" }, 403);
      }
      const rpcName = functionName;
      const rpcArgs = functionName === "publish_global_plan_rules" || TEAM_RPC_FUNCTIONS.has(functionName)
        ? { ...(body.args || {}), p_actor_id: profile.id }
        : (body.args || {});
      const { data, error } = await supabaseAdmin.rpc(rpcName, rpcArgs);
      if (error) return jsonResponse({ error: error.message, details: error }, 400);
      return jsonResponse({ data, profile });
    }

    // ── send_care_reminder: server-side forced sender_id ──
    if (action === "send_care_reminder") {
      const p = body.payload || {};
      const validReasons = ["behind", "inactive", "care", "encouragement"];
      if (!p.recipient_id) return jsonResponse({ error: "missing_recipient_id" }, 400);
      if (!validReasons.includes(p.reason)) return jsonResponse({ error: "invalid_reason" }, 400);
      const msg = String(p.message || "").trim();
      if (!msg || msg.length > 300) return jsonResponse({ error: "invalid_message" }, 400);
      const pastoralRoles = ["admin", "great_zone_leader", "zone_leader", "group_leader"];
      if (!pastoralRoles.includes(profile.role) || profile.id === p.recipient_id) {
        return jsonResponse({ error: "pastoral_reminder_scope_required" }, 403);
      }
      const { data: recipient, error: recipientError } = await supabaseAdmin
        .from("profiles")
        .select("id, is_active, great_region, pastoral_zone, small_group")
        .eq("id", p.recipient_id)
        .maybeSingle();
      if (recipientError) return jsonResponse({ error: recipientError.message }, 400);
      if (!recipient || recipient.is_active === false) return jsonResponse({ error: "recipient_not_found" }, 404);

      const withinScope = isAdmin(profile)
        || (profile.role === "great_zone_leader" && valuesOverlap(recipient.great_region, profile.great_region))
        || (profile.role === "zone_leader" && valuesOverlap(recipient.pastoral_zone, profile.pastoral_zone))
        || (profile.role === "group_leader"
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
      return jsonResponse({ data: null, profile });
    }
    if (action === "save_profile") {
      const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      const updatePayload = {
        name: payload.name ?? profile.name ?? "",
        great_region: payload.great_region ?? profile.great_region ?? "",
        pastoral_zone: payload.pastoral_zone ?? profile.pastoral_zone ?? "",
        small_group: payload.small_group ?? profile.small_group ?? "",
        great_region_id: payload.great_region_id ?? null,
        pastoral_zone_id: payload.pastoral_zone_id ?? null,
        small_group_id: payload.small_group_id ?? null,
        updated_at: new Date().toISOString()
      };

      const { data: savedProfile, error: saveError } = await supabaseAdmin
         .from("profiles")
         .update(updatePayload)
         .eq("id", profile.id)
         .select("*")
         .single();

      if (saveError) return jsonResponse({ error: saveError.message, details: saveError }, 400);
      if (!savedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);

      const expectedFields = ["name", "great_region", "pastoral_zone", "small_group"];
      const mismatches = expectedFields.filter(field => String((savedProfile as any)[field] || "") !== String((updatePayload as any)[field] || ""));
      if (mismatches.length > 0) {
        return jsonResponse({
          error: "profile_write_mismatch",
          mismatches,
          expected: updatePayload,
          actual: savedProfile,
          project_url: supabaseUrl,
          profile_id: profile.id
        }, 500);
      }

      return jsonResponse({ data: savedProfile, profile: savedProfile, project_url: supabaseUrl, profile_id: profile.id });
    }

    const canRead = action === "select" && READ_TABLES.has(table);
    const canOwnWrite = ["insert", "update", "delete", "upsert"].includes(action) && OWN_WRITE_TABLES.has(table);
    const canAdminWrite = ["insert", "update", "delete", "upsert"].includes(action) && ADMIN_WRITE_TABLES.has(table) && isAdmin(profile);
    if (!canRead && !canOwnWrite && !canAdminWrite) return jsonResponse({ error: "forbidden" }, 403);

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
    if (body.limit) query = query.limit(body.limit);
    if (body.returning === "single") query = query.single();
    else if (body.returning === "maybeSingle") query = query.maybeSingle();

    const { data, error } = await query;
    if (error) return jsonResponse({ error: error.message, details: error }, 400);

    let responseData = data;
    if (table === "profiles" && ["insert", "update", "upsert"].includes(action)) {
      const { data: verifiedProfile, error: verifyError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", profile.id)
        .maybeSingle();
      if (verifyError) return jsonResponse({ error: verifyError.message, details: verifyError }, 400);
      if (!verifiedProfile) return jsonResponse({ error: "profile_write_not_verified" }, 500);
      responseData = verifiedProfile;
    }

    return jsonResponse({ data: responseData, profile });
  } catch (err) {
    console.error("nlc-data failed:", err);
    return jsonResponse({ error: "nlc_data_failed", message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
