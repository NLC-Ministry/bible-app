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
  "profile_identity_overview",
  "member_reading_summary",
  "view_pastoral_zone_stats",
  "view_small_group_stats"
]);
const USER_TABLES = new Set(["reading_plans", "reading_logs", "devotional_notes"]);
const ADMIN_WRITE_TABLES = new Set(["great_regions", "pastoral_zones", "small_groups", "global_plans", "church_announcements"]);
const OWN_WRITE_TABLES = new Set(["profiles", "reading_plans", "reading_logs", "devotional_notes"]);

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

async function resolveProfile(supabaseAdmin: any, accessToken: string) {
  const issuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
  const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
  const userinfo = await fetchJson(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  if (!userinfo?.sub) throw new Error("invalid_logto_token");

  const { data: identity, error: identityError } = await supabaseAdmin
    .from("user_identities")
    .select("profile_id")
    .eq("provider", "logto")
    .eq("provider_user_id", userinfo.sub)
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
  return profile?.role === "admin" || profile?.role === "senior_pastor";
}

function normalizeRows(payload: any) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

function forceUserPayload(table: string, payload: any, profileId: string) {
  if (table === "profiles") {
    const rows = normalizeRows(payload).map(row => ({ ...row, id: profileId }));
    return Array.isArray(payload) ? rows : rows[0];
  }
  if (USER_TABLES.has(table)) {
    const rows = normalizeRows(payload).map(row => ({ ...row, user_id: profileId }));
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

function applyForcedScope(query: any, table: string, action: string, profile: any) {
  if (action === "insert" || action === "upsert") return query;
  if (USER_TABLES.has(table)) return query.eq("user_id", profile.id);
  if (table === "profiles" && !isAdmin(profile)) return query.eq("id", profile.id);
  if (table === "user_identities") return query.eq("profile_id", profile.id);
  if (table === "global_plans" && action === "select" && !isAdmin(profile)) return query.eq("is_hidden", false);
  if (table === "church_announcements" && action === "select" && !isAdmin(profile)) return query.eq("is_published", true);
  return query;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    if (action !== "save_profile" && (!table || typeof table !== "string")) return jsonResponse({ error: "missing_table" }, 400);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const profile = await resolveProfile(supabaseAdmin, accessToken);

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
      const mismatches = expectedFields.filter(field => String(savedProfile[field] || "") !== String(updatePayload[field] || ""));
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
      query = supabaseAdmin.from(table).insert(forceUserPayload(table, body.payload, profile.id));
    } else if (action === "update") {
      query = supabaseAdmin.from(table).update(forceUserPayload(table, body.payload, profile.id));
    } else if (action === "delete") {
      query = supabaseAdmin.from(table).delete();
    } else if (action === "upsert") {
      query = supabaseAdmin.from(table).upsert(forceUserPayload(table, body.payload, profile.id), body.options || undefined);
    } else {
      return jsonResponse({ error: "unsupported_action" }, 400);
    }

    query = applyFilters(query, body.filters || []);
    if (body.or) query = query.or(body.or);
    query = applyForcedScope(query, table, action, profile);
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
