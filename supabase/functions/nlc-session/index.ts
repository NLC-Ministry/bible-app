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
  "admin"
]);

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

function pickOrgField(org: any, ...keys: string[]) {
  for (const key of keys) {
    const value = org?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function orgFromMemberContext(organization: any) {
  const org = organization || {};
  return {
    great_region: pickOrgField(org, "greatRegion", "homeRegionName"),
    pastoral_zone: pickOrgField(org, "pastoralZone", "homeZoneName"),
    small_group: pickOrgField(org, "smallGroup", "homeGroupName")
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
const HUB_OWNED_ORG_FIELDS = ["great_region", "pastoral_zone", "small_group"];

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function buildLockedFields(sourceValues: Record<string, string | null>, options: { hubLinked?: boolean } = {}) {
  const locked = Object.entries(sourceValues)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([field]) => field);

  if (options.hubLinked) {
    for (const field of HUB_OWNED_ORG_FIELDS) {
      if (!locked.includes(field)) locked.push(field);
    }
  }

  return locked;
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function projectOrgFieldsFromHub(
  mergedOrg: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null },
  existingProfile: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null } | null,
  hubLinked: boolean
) {
  const hubOrg = {
    great_region: mergedOrg?.great_region ? String(mergedOrg.great_region).trim() : "",
    pastoral_zone: mergedOrg?.pastoral_zone ? String(mergedOrg.pastoral_zone).trim() : "",
    small_group: mergedOrg?.small_group ? String(mergedOrg.small_group).trim() : ""
  };

  if (hubLinked) return hubOrg;

  const firstValue = (...values: any[]) => {
    for (const value of values) {
      if (value !== null && value !== undefined && String(value).trim() !== "") return String(value).trim();
    }
    return "";
  };

  return {
    great_region: firstValue(hubOrg.great_region, existingProfile?.great_region),
    pastoral_zone: firstValue(hubOrg.pastoral_zone, existingProfile?.pastoral_zone),
    small_group: firstValue(hubOrg.small_group, existingProfile?.small_group)
  };
}

/** Keep in sync with scripts/lib/nlc-profile-sync.mjs */
function mergeOrgSources(platformOrg: any, placementOrg: any, contextOrganization: any) {
  const contextOrg = orgFromMemberContext(contextOrganization);
  const homeNodeName = contextOrganization?.homeNodeName
    ? String(contextOrganization.homeNodeName).trim()
    : null;

  const pick = (field: "great_region" | "pastoral_zone" | "small_group") => {
    if (placementOrg?.[field]) return placementOrg[field];
    if (contextOrg[field]) return contextOrg[field];
    if (field === "pastoral_zone" && homeNodeName) return homeNodeName;
    if (platformOrg?.[field]) return platformOrg[field];
    return null;
  };

  return {
    great_region: pick("great_region"),
    pastoral_zone: pick("pastoral_zone"),
    small_group: pick("small_group")
  };
}

// Roles that must never be granted or inherited via a WEAK (email-only) account link.
const PRIVILEGED_ROLES = new Set([
  "admin", "great_zone_leader", "zone_leader", "group_leader"
]);

/**
 * Role policy — SECURITY: privilege is only granted/inherited on a STRONG identity
 * link (Logto sub or NLC member id). NLC identity can be phone-primary, so a token's
 * email is not proof of ownership; an email-only profile match must never escalate a
 * login into an admin/leader role. Keep in sync with the unit-tested
 * scripts/lib/nlc-account-link.mjs.
 *
 * TODO(Phase 2): Map org-placement leaderships[].roleName → scoped app roles.
 * See https://nlc-b1ffeeba.mintlify.site/api-reference/authorization-model
 */
function resolveSyncedRole(
  primaryRole: string | null | undefined,
  existingRole: string | null | undefined,
  linkedBy: "identity" | "member_id" | "email" | "none"
) {
  const strong = linkedBy === "identity" || linkedBy === "member_id" || linkedBy === "none";
  if (primaryRole === "admin" && strong && allowedRoles.has("admin")) return "admin";
  const existing = existingRole == null ? "" : String(existingRole).trim();
  if (existing !== "") {
    if (existing === "senior_pastor") return strong ? "admin" : "member";
    if (strong) return existing;
    return PRIVILEGED_ROLES.has(existing) ? "member" : existing;
  }
  return "member";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function hasAnyOrgField(org: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null }) {
  return Boolean(org.great_region || org.pastoral_zone || org.small_group);
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

async function resolveLocalOrgLinks(
  supabaseAdmin: any,
  profilePayload: { great_region?: string | null; pastoral_zone?: string | null; small_group?: string | null },
  memberContext: any
) {
  let great_region_id: string | null = null;
  let pastoral_zone_id: string | null = null;
  let small_group_id: string | null = null;
  let orgLinkStatus = memberContext ? "not_linked" : "skipped";
  let orgLinkError: string | null = null;

  const failed = (err: unknown) => {
    orgLinkStatus = "failed";
    orgLinkError = err instanceof Error ? err.message : String(err);
    console.warn("Member Hub org-tree link failed; continuing session sync with text org fields.", err);
    return {
      great_region_id: null,
      pastoral_zone_id: null,
      small_group_id: null,
      orgLinkStatus,
      orgLinkError
    };
  };

  try {
    // Rebuild the organization tree from authoritative Member Hub data as
    // members sign in. A degraded sync must never recreate stale local data.
    if (memberContext && profilePayload.great_region) {
      const { data: regionData, error: regionError } = await supabaseAdmin
        .from("great_regions")
        .upsert(
          { name: profilePayload.great_region },
          { onConflict: "name" }
        )
        .select("id")
        .single();
      if (regionError) return failed(regionError);
      great_region_id = regionData.id;
    }
    if (memberContext && profilePayload.pastoral_zone && great_region_id) {
      const { data: zoneData, error: zoneError } = await supabaseAdmin
        .from("pastoral_zones")
        .upsert(
          {
            name: profilePayload.pastoral_zone,
            great_region_id
          },
          { onConflict: "name,great_region_id" }
        )
        .select("id")
        .single();
      if (zoneError) return failed(zoneError);
      pastoral_zone_id = zoneData.id;
    }
    if (memberContext && profilePayload.small_group && pastoral_zone_id) {
      const { data: groupData, error: groupError } = await supabaseAdmin
        .from("small_groups")
        .upsert(
          {
            name: profilePayload.small_group,
            pastoral_zone_id
          },
          { onConflict: "name,pastoral_zone_id" }
        )
        .select("id")
        .single();
      if (groupError) return failed(groupError);
      small_group_id = groupData.id;
    }

    orgLinkStatus = memberContext && hasAnyOrgField(profilePayload) ? "linked" : orgLinkStatus;
  } catch (err) {
    return failed(err);
  }

  return {
    great_region_id,
    pastoral_zone_id,
    small_group_id,
    orgLinkStatus,
    orgLinkError
  };
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

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: localCorsHeaders });
  }
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

    const { access_token: accessToken, id_token: idToken } = await req.json().catch(() => ({}));
    if (!accessToken || typeof accessToken !== "string") {
      return jsonResponse({ error: "missing_access_token" }, 400);
    }

    const bearerHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    };

    let userinfo: any = null;
    if (idToken && typeof idToken === "string") {
      userinfo = parseJwt(idToken);
    }

    if (!userinfo || !userinfo.sub || !userinfo.email) {
      console.log("UserInfo from token is incomplete or missing email; fetching full profile from OIDC UserInfo endpoint.");
      try {
        const discovery = await fetchJson(`${issuer}/.well-known/openid-configuration`);
        const userinfoEndpoint = discovery.userinfo_endpoint;
        if (userinfoEndpoint) {
          const fullUserinfo = await fetchJson(userinfoEndpoint, { headers: bearerHeaders });
          if (fullUserinfo && fullUserinfo.sub) {
            userinfo = { ...userinfo, ...fullUserinfo };
          }
        }
      } catch (err) {
        console.warn("Failed to fetch full userinfo from OIDC endpoint:", err);
      }
    }

    if (!userinfo || !userinfo.sub) {
      return jsonResponse({ error: "invalid_userinfo" }, 401);
    }

    let memberContext: any = null;
    let memberContextError: string | null = null;
    try {
      const memberResponse = await fetchJson(`${memberHubUrl}/api/me/context`, {
        headers: bearerHeaders
      });
      memberContext = memberResponse?.context || null;
    } catch (err) {
      console.error("Member Hub context fetch failed:", err);
      memberContextError = `member_hub_context_failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    if (!memberContext) {
      memberContextError = memberContextError || "member_hub_context_missing";
    }

    const memberProfile = memberContext?.profile || {};
    const memberIdentity = memberContext?.identity || {};
    const organization = memberContext?.organization || {};
    const memberId = memberIdentity.memberId || null;
    const membershipStatus = memberProfile.membershipStatus || null;

    let platformOrganization: any = null;
    let platformOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };

    if (memberId) {
      const platformResponse = await fetchJsonOptional(
        `${platformApiUrl}/members/${encodeURIComponent(memberId)}/organization`,
        { headers: bearerHeaders }
      );
      platformOrganization = platformResponse?.organization || null;
      if (platformOrganization?.careChain) {
        platformOrgFields = orgFromCareChain(platformOrganization.careChain);
      }
    }

    let placementOrgFields = { great_region: null as string | null, pastoral_zone: null as string | null, small_group: null as string | null };

    const contextOrgFields = orgFromMemberContext(organization);
    const mergedOrg = mergeOrgSources(platformOrgFields, placementOrgFields, organization);
    const orgResolutionSource = hasAnyOrgField(placementOrgFields)
      ? "member_hub_org_placement"
      : (hasAnyOrgField(contextOrgFields) ? "member_hub_context" : (hasAnyOrgField(platformOrgFields) ? "platform_organization" : "none"));

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
    // How the existing profile was matched — governs privilege in resolveSyncedRole.
    let linkSource: "identity" | "member_id" | "email" | "none" = profileId ? "identity" : "none";

    const lookupEmail = userinfo.email || memberIdentity.email || null;

    // Strong link: match an existing profile by the authenticated NLC member id.
    if (!profileId && memberId) {
      const { data: profileByMember, error: memberLookupError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("nlc_member_id", memberId)
        .maybeSingle();
      if (memberLookupError) throw memberLookupError;
      if (profileByMember) {
        existingProfile = profileByMember;
        profileId = profileByMember.id;
        linkSource = "member_id";
      }
    }

    // Weak link: match by email only. NLC identity can be phone-primary, so the token
    // email may not be caller-owned; resolveSyncedRole refuses to escalate privilege here.
    if (!profileId && lookupEmail) {
      const { data: profileByEmail, error: profileLookupError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .ilike("email", lookupEmail)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (profileLookupError) throw profileLookupError;
      if (profileByEmail) {
        existingProfile = profileByEmail;
        profileId = profileByEmail.id;
        linkSource = "email";
      }
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

    const syncedRole = resolveSyncedRole(memberContext?.primaryRole, existingProfile?.role, linkSource);

    // Member Hub is canonical only when the context endpoint was reachable for this session.
    const hubLinked = !!memberContext;
    const projectedOrg = projectOrgFieldsFromHub(mergedOrg, existingProfile, hubLinked);

    const sourceValues: Record<string, string | null> = {
      email: lookupEmail,
      name: memberProfile.displayName || userinfo.name || userinfo.preferred_username || memberIdentity.username || null,
      great_region: projectedOrg.great_region || null,
      pastoral_zone: projectedOrg.pastoral_zone || null,
      small_group: projectedOrg.small_group || null,
      role: syncedRole === "admin" ? "admin" : null
    };

    const lockedFields = buildLockedFields(sourceValues, { hubLinked });

    const firstValue = (...values: any[]) => {
      for (const value of values) {
        if (value !== null && value !== undefined && String(value).trim() !== "") return value;
      }
      return "";
    };

    const nowIso = new Date().toISOString();
    const memberContextSyncStatus = memberContext ? "success" : "degraded";
    const profilePayload: Record<string, any> = {
      id: profileId,
      name: firstValue(sourceValues.name, existingProfile?.name, "NLC User"),
      email: firstValue(sourceValues.email, existingProfile?.email, null) || null,
      great_region: projectedOrg.great_region,
      pastoral_zone: projectedOrg.pastoral_zone,
      small_group: projectedOrg.small_group,
      role: syncedRole,
      is_demo: false,
      is_active: true,
      last_seen_at: nowIso,
      member_context_synced_at: memberContext ? nowIso : (existingProfile?.member_context_synced_at || null),
      member_context_sync_attempted_at: nowIso,
      member_context_sync_status: memberContextSyncStatus,
      member_context_sync_error: memberContextError,
      updated_at: nowIso
    };

    if (memberId) {
      profilePayload.nlc_member_id = memberId;
    } else if (existingProfile?.nlc_member_id) {
      profilePayload.nlc_member_id = existingProfile.nlc_member_id;
    }

    const {
      great_region_id,
      pastoral_zone_id,
      small_group_id,
      orgLinkStatus,
      orgLinkError
    } = await resolveLocalOrgLinks(supabaseAdmin, profilePayload, memberContext);

    profilePayload.great_region_id = (great_region_id || (profilePayload.great_region === existingProfile?.great_region ? existingProfile?.great_region_id : null)) || null;
    profilePayload.pastoral_zone_id = (pastoral_zone_id || (profilePayload.pastoral_zone === existingProfile?.pastoral_zone ? existingProfile?.pastoral_zone_id : null)) || null;
    profilePayload.small_group_id = (small_group_id || (profilePayload.small_group === existingProfile?.small_group ? existingProfile?.small_group_id : null)) || null;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" })
      .select("*")
      .single();

    if (profileError) throw profileError;

    // Prune only after an authoritative Hub projection has been committed.
    // The database function applies a grace period so concurrent sessions can
    // finish linking nodes they have just upserted.
    let orgCleanupStatus = memberContext ? "pending" : "skipped";
    let orgCleanupResult: any = null;
    let orgCleanupError: string | null = null;
    if (memberContext) {
      const { data: cleanupData, error: cleanupError } = await supabaseAdmin
        .rpc("prune_orphaned_church_org_nodes", {});
      if (cleanupError) {
        orgCleanupStatus = "failed";
        orgCleanupError = cleanupError.message || String(cleanupError);
        console.warn("Orphaned organization cleanup failed; continuing session sync.", cleanupError);
      } else {
        orgCleanupStatus = "success";
        orgCleanupResult = cleanupData;
      }
    }

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
    identityMetadata.org_resolution_source = orgResolutionSource;
    identityMetadata.org_resolution = {
      source: orgResolutionSource,
      placement_available: hasAnyOrgField(placementOrgFields),
      platform_available: hasAnyOrgField(platformOrgFields),
      context_available: hasAnyOrgField(contextOrgFields),
      org_link_status: orgLinkStatus,
      org_link_error: orgLinkError,
      org_cleanup_status: orgCleanupStatus,
      org_cleanup_result: orgCleanupResult,
      org_cleanup_error: orgCleanupError
    };
    if (memberContextError) {
      identityMetadata.member_context_error = memberContextError;
    }
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
      membership_status: membershipStatus,
      member_context_error: memberContextError
    });
  } catch (err) {
    // Log full detail server-side
    console.error("nlc-session failed:", err);
    // Bubble up error details to frontend console for direct diagnostics
    return jsonResponse({ 
      error: "nlc_session_failed", 
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    }, 500);
  }
});
