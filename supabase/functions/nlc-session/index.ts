import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const allowedRoles = new Set([
  "member",
  "group_leader",
  "zone_leader",
  "great_zone_leader",
  "admin",
  "senior_pastor"
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeSecret(value: string | undefined | null) {
  const trimmed = (value || "").trim();
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function base64Url(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${base64Url(signature)}`;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const jwtSecret = normalizeSecret(Deno.env.get("NLC_SUPABASE_JWT_SECRET") || Deno.env.get("SUPABASE_JWT_SECRET"));
    const issuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
    const memberHubUrl = trimSlash(Deno.env.get("NLC_MEMBER_HUB_URL") || "https://member.newlife.org.tw");

    if (!supabaseUrl || !serviceRoleKey || !jwtSecret) {
      return jsonResponse({ error: "server_not_configured" }, 500);
    }

    const { access_token: accessToken } = await req.json().catch(() => ({}));
    if (!accessToken || typeof accessToken !== "string") {
      return jsonResponse({ error: "missing_access_token" }, 400);
    }

    const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
    const userinfoEndpoint = discovery.userinfo_endpoint;
    if (!userinfoEndpoint) return jsonResponse({ error: "userinfo_endpoint_missing" }, 500);

    const userinfo = await fetchJson(userinfoEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    });

    if (!userinfo || !userinfo.sub) {
      return jsonResponse({ error: "invalid_userinfo" }, 401);
    }

    let memberContext: any = null;
    try {
      const memberResponse = await fetchJson(`${memberHubUrl}/api/me/context`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      });
      memberContext = memberResponse?.context || null;
    } catch (err) {
      console.warn("Member Hub context unavailable:", err);
    }

    const memberProfile = memberContext?.profile || {};
    const memberIdentity = memberContext?.identity || {};
    const organization = memberContext?.organization || {};
    const email = userinfo.email || memberIdentity.email || null;
    const displayName =
      memberProfile.displayName ||
      userinfo.name ||
      userinfo.preferred_username ||
      memberIdentity.username ||
      email ||
      "NLC User";
    const requestedRole = memberContext?.primaryRole || "member";
    const role = allowedRoles.has(requestedRole) ? requestedRole : "member";

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: existingIdentity, error: identityError } = await supabaseAdmin
      .from("user_identities")
      .select("profile_id")
      .eq("provider", "logto")
      .eq("provider_user_id", userinfo.sub)
      .maybeSingle();

    if (identityError) throw identityError;

    let profileId = existingIdentity?.profile_id || null;

    if (!profileId && email) {
      const { data: existingProfile, error: profileLookupError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      profileId = existingProfile?.id || null;
    }

    if (!profileId) profileId = crypto.randomUUID();

    const nowIso = new Date().toISOString();
    const profilePayload = {
      id: profileId,
      name: displayName,
      email,
      great_region: organization.homeRegionName || "",
      pastoral_zone: organization.homeZoneName || organization.homeNodeName || "",
      small_group: organization.homeGroupName || organization.homeNodeName || "",
      role,
      is_demo: false,
      is_active: true,
      last_seen_at: nowIso,
      updated_at: nowIso
    };

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" })
      .select("*")
      .single();

    if (profileError) throw profileError;

    const { error: clearPrimaryError } = await supabaseAdmin
      .from("user_identities")
      .update({ is_primary: false, updated_at: nowIso })
      .eq("profile_id", profileId);

    if (clearPrimaryError) throw clearPrimaryError;

    const { error: upsertIdentityError } = await supabaseAdmin
      .from("user_identities")
      .upsert({
        profile_id: profileId,
        provider: "logto",
        provider_user_id: userinfo.sub,
        email,
        display_name: displayName,
        is_primary: true,
        metadata: {
          issuer,
          userinfo,
          member_context: memberContext
        },
        last_seen_at: nowIso,
        updated_at: nowIso
      }, { onConflict: "provider,provider_user_id" });

    if (upsertIdentityError) throw upsertIdentityError;

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 60 * 60;
    const token = await signJwt({
      aud: "authenticated",
      exp: now + expiresIn,
      iat: now,
      iss: "nlc-session-edge-function",
      sub: userinfo.sub,
      role: "authenticated",
      profile_id: profileId
    }, jwtSecret);
    if (anonKey) {
      const verifyResponse = await fetch(supabaseUrl + "/rest/v1/profiles?select=id&id=eq." + profileId, {
        headers: {
          apikey: anonKey,
          Authorization: "Bearer " + token,
          Accept: "application/json"
        }
      });
      if (!verifyResponse.ok) {
        const verifyText = await verifyResponse.text().catch(() => "");
        return jsonResponse({
          error: "generated_jwt_rejected_by_supabase",
          message: "The JWT generated by nlc-session was rejected by Supabase. Check NLC_SUPABASE_JWT_SECRET; it must be the current Supabase JWT secret, not JWKS URI or a previous key.",
          status: verifyResponse.status,
          detail: verifyText
        }, 500);
      }
    }



    return jsonResponse({
      access_token: token,
      token_type: "bearer",
      expires_in: expiresIn,
      profile
    });
  } catch (err) {
    console.error("nlc-session failed:", err);
    return jsonResponse({
      error: "nlc_session_failed",
      message: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});
