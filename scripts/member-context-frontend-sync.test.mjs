import { describe, expect, it } from "vitest";
import fs from "node:fs";

const dbSource = fs.readFileSync("js/db.js", "utf8");
const authSource = fs.readFileSync("js/auth.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");
const profileSource = fs.readFileSync("js/modules/profile.js", "utf8");

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  if (start === -1) throw new Error(`Could not find ${signature}`);

  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error(`Could not extract ${signature}`);
}

function loadApplyNlcProfile(state) {
  const method = extractFunction(dbSource, "applyNlcProfile(profile, lockedFields = null) {")
    .replace("applyNlcProfile(profile, lockedFields = null)", "function applyNlcProfile(profile, lockedFields = null)");
  return new Function("state", "getDisplayName", `return (${method});`)(
    state,
    (profile) => String(profile.name || "").trim()
  );
}

function loadProfileIdentityChrome({ state, memberHubManaged }) {
  const getLeadershipDisplayLabel = new Function(
    "isMemberHubManagedProfile",
    `return (${extractFunction(profileSource, "function getLeadershipDisplayLabel(user) {")});`
  )(() => memberHubManaged);
  const paintProfileIdentityChrome = new Function(
    "state",
    "getLeadershipDisplayLabel",
    "renderMemberHubOrgPlacement",
    `return (${extractFunction(profileSource, "function paintProfileIdentityChrome() {")});`
  )(state, getLeadershipDisplayLabel, () => {});
  return paintProfileIdentityChrome;
}

function createRoleElement() {
  return {
    attributes: new Map(),
    textContent: "",
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  };
}

function renderRole({ user, memberHubManaged }) {
  const roleElement = createRoleElement();
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return id === "profile-summary-role" ? roleElement : null;
    }
  };

  try {
    loadProfileIdentityChrome({
      state: { currentUser: user, profileIdentityLoading: false },
      memberHubManaged
    })();
  } finally {
    globalThis.document = previousDocument;
  }

  return roleElement.textContent;
}

describe("member context frontend sync metadata", () => {
  it("copies member_context_synced_at from the projected profile into state.currentUser", () => {
    expect(dbSource).toMatch(/state\.currentUser\.member_context_synced_at\s*=\s*profile\.member_context_synced_at\s*\|\|\s*""/);
  });

  it("copies member context sync status fields from the projected profile into state.currentUser", () => {
    expect(dbSource).toMatch(/state\.currentUser\.member_context_sync_attempted_at\s*=\s*profile\.member_context_sync_attempted_at\s*\|\|\s*""/);
    expect(dbSource).toMatch(/state\.currentUser\.member_context_sync_status\s*=\s*profile\.member_context_sync_status\s*\|\|\s*""/);
    expect(dbSource).toMatch(/state\.currentUser\.member_context_sync_error\s*=\s*profile\.member_context_sync_error\s*\|\|\s*""/);
  });

  it("preserves member_context_synced_at in the cached nlc profile payload", () => {
    expect(dbSource).toMatch(/localStorage\.setItem\("nlc_supabase_profile",\s*JSON\.stringify\(payload\.profile\)\)/);
  });

  it("forces a fresh Logto access token when manually refreshing Member Hub context", () => {
    expect(dbSource).toMatch(/auth\.getValidAccessToken\(force\)/);
  });

  it("manual org refresh bypasses the cached Edge session and reapplies the returned profile", () => {
    expect(profileSource).toContain("await db.syncNlcSessionWithSupabase(true)");
    expect(dbSource).toContain("if (!force && cachedExpiresAt > Date.now() + 60000)");
    expect(dbSource).toContain("this.applyNlcProfile(payload.profile, payload.locked_fields || [])");
  });

  it("does not discard a valid access token when force refresh is requested without a refresh token", () => {
    expect(authSource).toContain("force_refresh_without_refresh_token");
    expect(authSource).toMatch(/forceRefresh\s*&&\s*!refreshToken\s*&&\s*token\s*&&\s*Date\.now\(\)\s*<\s*expiresAt\s*-\s*60000/);
    expect(authSource).toMatch(/return\s+token/);
  });

  it("initializes member_context_synced_at for fresh and reset app state", () => {
    expect(stateSource).toContain('member_context_synced_at: ""');
    expect(authSource).toContain('member_context_synced_at: ""');
  });

  it("initializes member context sync status fields for fresh and reset app state", () => {
    ["member_context_sync_attempted_at", "member_context_sync_status", "member_context_sync_error"].forEach((field) => {
      expect(stateSource).toContain(`${field}: ""`);
      expect(authSource).toContain(`${field}: ""`);
    });
  });

  it("copies Member Hub leadership identity fields into currentUser state", () => {
    const state = { currentUser: {} };
    const assignments = [{ id: "assignment-1", label: "小組長" }];

    loadApplyNlcProfile(state).call({ refreshRoleDependentUI() {} }, {
      id: "profile-1",
      role: "member",
      member_context_leadership_display_label: "區長",
      member_context_leadership_primary_assignment_id: "assignment-1",
      member_context_leadership_assignments: assignments
    });

    expect(state.currentUser.member_context_leadership_display_label).toBe("區長");
    expect(state.currentUser.member_context_leadership_primary_assignment_id).toBe("assignment-1");
    expect(state.currentUser.member_context_leadership_assignments).toBe(assignments);
  });

  it("renders the Hub leadership display label before the legacy role label", () => {
    expect(renderRole({
      user: { role: "group_leader", member_context_leadership_display_label: "牧區同工" },
      memberHubManaged: true
    })).toBe("牧區同工");
  });

  it("renders 一般組員 for a Hub-managed user without a leadership display label", () => {
    expect(renderRole({
      user: { role: "group_leader", member_context_leadership_display_label: "" },
      memberHubManaged: true
    })).toBe("一般組員");
  });

  it("uses the legacy role label when a non-Hub session has no leadership display label", () => {
    expect(renderRole({
      user: { role: "group_leader", member_context_leadership_display_label: "" },
      memberHubManaged: false
    })).toBe("小組長");
  });
});
