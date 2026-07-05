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

const LEVEL_DEPTH = {
  great_region: 0,
  pastoral_zone: 1,
  small_group: 2
};

const LEVEL_NAME_HINTS: Record<string, string[]> = {
  great_region: ["大區"],
  pastoral_zone: ["牧區"],
  small_group: ["小組"]
};

function pickNameByDepth(segments: any[], depth: number) {
  if (!Array.isArray(segments)) return null;
  const match = segments.find((seg) => seg && seg.levelDepth === depth);
  if (match?.name) return String(match.name).trim() || null;
  const byIndex = segments[depth];
  if (byIndex?.name) return String(byIndex.name).trim() || null;
  return null;
}

function pickNameByLevelName(segments: any[], hints: string[]) {
  if (!Array.isArray(segments) || !hints.length) return null;
  const match = segments.find((seg) => {
    const label = String(seg?.levelName || "").trim();
    return hints.some((hint) => label.includes(hint));
  });
  return match?.name ? String(match.name).trim() || null : null;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromCareChain(careChain: any[]) {
  return {
    great_region: pickNameByDepth(careChain, LEVEL_DEPTH.great_region),
    pastoral_zone: pickNameByDepth(careChain, LEVEL_DEPTH.pastoral_zone),
    small_group: pickNameByDepth(careChain, LEVEL_DEPTH.small_group)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromHomePath(path: any[]) {
  if (!Array.isArray(path)) {
    return { great_region: null, pastoral_zone: null, small_group: null };
  }
  return {
    great_region: pickNameByLevelName(path, LEVEL_NAME_HINTS.great_region) || pickNameByDepth(path, 0),
    pastoral_zone: pickNameByLevelName(path, LEVEL_NAME_HINTS.pastoral_zone) || pickNameByDepth(path, 1),
    small_group: pickNameByLevelName(path, LEVEL_NAME_HINTS.small_group) || pickNameByDepth(path, 2)
  };
}

/** Legacy Member Hub fields — remove after production validation. */
function orgFromLegacyOrganization(organization: any) {
  const org = organization || {};
  return {
    great_region: org.homeRegionName ? String(org.homeRegionName).trim() : null,
    pastoral_zone: org.homeZoneName ? String(org.homeZoneName).trim() : null,
    small_group: org.homeGroupName ? String(org.homeGroupName).trim() : null
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function mergeOrgSources(platformOrg: any, placementOrg: any, contextOrganization: any) {
  const legacy = orgFromLegacyOrganization(contextOrganization);
  const homeNodeName = contextOrganization?.homeNodeName
    ? String(contextOrganization.homeNodeName).trim()
    : null;

  const pick = (field: "great_region" | "pastoral_zone" | "small_group") => {
    if (platformOrg?.[field]) return platformOrg[field];
    if (placementOrg?.[field]) return placementOrg[field];
    if (legacy[field]) return legacy[field];
    if (field === "pastoral_zone" && homeNodeName) return homeNodeName;
    return null;
  };

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

/**
 * Phase 1 role policy: Hub primaryRole admin → app admin; else preserve existing Supabase role.
 *
 * TODO(Phase 2): Map org-placement leaderships[].roleName → scoped app roles.
 * See https://nlc-b1ffeeba.mintlify.site/api-reference/member-org-placement
 * and https://nlc-b1ffeeba.mintlify.site/api-reference/authorization-model
 */
function resolveSyncedRole(primaryRole: string | null | undefined, existingRole: string | null | undefined) {
  if (primaryRole === "admin" && allowedRoles.has("admin")) return "admin";
  if (existingRole !== null && existingRole !== undefined && String(existingRole).trim() !== "") {
    return String(existingRole).trim();
  }
  return "member";
}

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

async function fetchJsonOptional(url: string, init?: RequestInit) {
  try {
    return await fetchJson(url, init);
  } catch (err) {
    console.warn("Optional fetch failed:", url, err);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const issuer = trimSlash(Deno.env.get("NLC_LOGTO_ISSUER") || "https://sso.newlife.org.tw/oidc");
    const memberHubUrl = trimSlash(Deno.env.get("NLC_MEMBER_HUB_URL") || "https://member.newlife.org.tw");
    const platformApiUrl = trimSlash(
      Deno.env.get("NLC_PLATFORM_API_URL") || "https://platform.newlife.org.tw/platform/v1"
    );

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "server_not_configured" }, 500);
    }

    const { access_token: accessToken } = await req.json().catch(() => ({}));
    if (!accessToken || typeof accessToken !== "string") {
      return jsonResponse({ error: "missing_access_token" }, 400);
    }

    const bearerHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
    const userinfoEndpoint = discovery.userinfo_endpoint;
    if (!userinfoEndpoint) return jsonResponse({ error: "userinfo_endpoint_missing" }, 500);

    const userinfo = await fetchJson(userinfoEndpoint, { headers: bearerHeaders });

    if (!userinfo || !userinfo.sub) {
      return jsonResponse({ error: "invalid_userinfo" }, 401);
    }

    let memberContext: any = null;
    const memberResponse = await fetchJsonOptional(`${memberHubUrl}/api/me/context`, {
      headers: bearerHeaders
    });
    memberContext = memberResponse?.context || null;

    const memberProfile = memberContext?.profile || {};
    const memberIdentity = memberContext?.identity || {};
    const organization = memberContext?.organization || {};
    const memberId = memberIdentity.memberId || null;
    const membershipStatus = memberProfile.membershipStatus || null;

    let platformOrganization: any = null;
    let platformOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };

    if (memberId) {
      const platformResponse = await fetchJsonOptional(
        `${platformApiUrl}/members/${memberId}/organization`,
        { headers: bearerHeaders }
      );
      platformOrganization = platformResponse?.organization || null;
      if (platformOrganization?.careChain) {
        platformOrgFields = orgFromCareChain(platformOrganization.careChain);
      }
    }

    let placementOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };
    const needsPlacementFallback = !platformOrgFields.great_region &&
      !platformOrgFields.pastoral_zone &&
      !platformOrgFields.small_group;

    if (needsPlacementFallback) {
      const placementResponse = await fetchJsonOptional(`${memberHubUrl}/api/me/org-placement`, {
        headers: bearerHeaders
      });
      const homePath = placementResponse?.placement?.home?.path;
      if (homePath) {
        placementOrgFields = orgFromHomePath(homePath);
      }
    }

    const mergedOrg = mergeOrgSources(platformOrgFields, placementOrgFields, organization);

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
    let existingProfile: any = null;

    const lookupEmail = userinfo.email || memberIdentity.email || null;

    if (!profileId && lookupEmail) {
      const { data: profileByEmail, error: profileLookupError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .ilike("email", lookupEmail)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      existingProfile = profileByEmail || null;
      profileId = existingProfile?.id || null;
    }

    if (profileId && !existingProfile) {
      const { data: profileById, error: profileByIdError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", profileId)
        .maybeSingle();
      if (profileByIdError) throw profileByIdError;
      existingProfile = profileById || null;
    }

    if (!profileId) profileId = crypto.randomUUID();

    const syncedRole = resolveSyncedRole(memberContext?.primaryRole, existingProfile?.role);

    const sourceValues: Record<string, string | null> = {
      email: lookupEmail,
      name: memberProfile.displayName || userinfo.name || userinfo.preferred_username || memberIdentity.username || null,
      great_region: mergedOrg.great_region,
      pastoral_zone: mergedOrg.pastoral_zone,
      small_group: mergedOrg.small_group,
      role: syncedRole === "admin" ? "admin" : null
    };

    const lockedFields = Object.entries(sourceValues)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
      .map(([field]) => field);

    const firstValue = (...values: any[]) => {
      for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim() !== "") return value;
      }
      return "";
    };

    const nowIso = new Date().toISOString();
    const profilePayload: Record<string, any> = {
      id: profileId,
      name: firstValue(sourceValues.name, existingProfile?.name, "NLC User"),
      email: firstValue(sourceValues.email, existingProfile?.email, null) || null,
      great_region: firstValue(sourceValues.great_region, existingProfile?.great_region),
      pastoral_zone: firstValue(sourceValues.pastoral_zone, existingProfile?.pastoral_zone),
      small_group: firstValue(sourceValues.small_group, existingProfile?.small_group),
      role: syncedRole,
      is_demo: false,
      is_active: true,
      last_seen_at: nowIso,
      updated_at: nowIso
    };

    if (memberId) {
      profilePayload.nlc_member_id = memberId;
    } else if (existingProfile?.nlc_member_id) {
      profilePayload.nlc_member_id = existingProfile.nlc_member_id;
    }

    let great_region_id: string | null = null;
    let pastoral_zone_id: string | null = null;
    let small_group_id: string | null = null;

    if (profilePayload.great_region) {
      const { data: regionData } = await supabaseAdmin
        .from("great_regions")
        .select("id")
        .eq("name", profilePayload.great_region)
        .maybeSingle();
      if (regionData) great_region_id = regionData.id;
    }
    if (profilePayload.pastoral_zone) {
      let query = supabaseAdmin.from("pastoral_zones").select("id").eq("name", profilePayload.pastoral_zone);
      if (great_region_id) query = query.eq("great_region_id", great_region_id);
      const { data: zoneData } = await query.maybeSingle();
      if (zoneData) pastoral_zone_id = zoneData.id;
    }
    if (profilePayload.small_group) {
      let query = supabaseAdmin.from("small_groups").select("id").eq("name", profilePayload.small_group);
      if (pastoral_zone_id) query = query.eq("pastoral_zone_id", pastoral_zone_id);
      const { data: groupData } = await query.maybeSingle();
      if (groupData) small_group_id = groupData.id;
    }

    profilePayload.great_region_id = (great_region_id || (profilePayload.great_region === existingProfile?.great_region ? existingProfile?.great_region_id : null)) || null;
    profilePayload.pastoral_zone_id = (pastoral_zone_id || (profilePayload.pastoral_zone === existingProfile?.pastoral_zone ? existingProfile?.pastoral_zone_id : null)) || null;
    profilePayload.small_group_id = (small_group_id || (profilePayload.small_group === existingProfile?.small_group ? existingProfile?.small_group_id : null)) || null;

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

    const identityMetadata: Record<string, unknown> = {
      issuer,
      userinfo,
      member_context: memberContext
    };
    if (platformOrganization) {
      identityMetadata.platform_organization = platformOrganization;
    }
    if (membershipStatus) {
      identityMetadata.membership_status = membershipStatus;
    }

    const { error: upsertIdentityError } = await supabaseAdmin
      .from("user_identities")
      .upsert({
        profile_id: profileId,
        provider: "logto",
        provider_user_id: userinfo.sub,
        email: profilePayload.email,
        display_name: profilePayload.name,
        is_primary: true,
        metadata: identityMetadata,
        last_seen_at: nowIso,
        updated_at: nowIso
      }, { onConflict: "provider,provider_user_id" });

    if (upsertIdentityError) throw upsertIdentityError;

    return jsonResponse({
      edge_session: true,
      profile,
      locked_fields: lockedFields,
      membership_status: membershipStatus
    });
  } catch (err) {
    console.error("nlc-session failed:", err);
    return jsonResponse({
      error: "nlc_session_failed",
      message: err instanceof Error ? err.message : String(err)
    }, 500);
  }
});
