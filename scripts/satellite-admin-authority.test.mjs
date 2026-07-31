import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  collectHubPermissionSignals,
  resolveSyncedRoleId
} from "./lib/nlc-profile-sync.mjs";

const migration = readFileSync("supabase/migrations/0053_satellite_admin_authority.sql", "utf8");
const sessionEdge = readFileSync("supabase/functions/nlc-session/index.ts", "utf8");
const profile = readFileSync("js/modules/profile.js", "utf8");
const html = readFileSync("index.html", "utf8");

const definitions = [
  {
    id: "group-id",
    code: "group_leader",
    label: "小組長",
    sort_order: 50,
    hub_permission_keys: ["small_group_leader"],
    hub_permission_labels: ["小組長"]
  },
  {
    id: "member-id",
    code: "member",
    label: "一般會友",
    sort_order: 60,
    hub_permission_keys: ["member"],
    hub_permission_labels: ["會友"]
  },
  {
    id: "admin-id",
    code: "admin",
    label: "系統管理員",
    sort_order: 10,
    hub_permission_keys: ["admin", "system_admin", "satellite_admin"],
    hub_permission_labels: ["管理員"]
  }
];

const sampleContext = {
  identity: {
    memberId: "018f4d18-8b8b-7760-9d7d-0c8e4f3c2a11",
    provider: "logto",
    providerSubject: "logto-subject"
  },
  profile: {
    displayName: "王小明",
    membershipStatus: "official_member"
  },
  membershipState: "approved",
  hasRequiredPlacement: true,
  organization: {
    placementNodeId: "node-small-group-1",
    placementNodeName: "恩典小組",
    placementLevelName: "小組"
  },
  roles: ["member", "satellite_admin"],
  primaryRole: "satellite_admin",
  leadershipIdentity: {
    displayLabel: "小組長",
    assignments: [{
      identityKey: "small_group_leader",
      displayName: "小組長",
      nodeId: "node-small-group-1",
      nodeName: "恩典小組",
      isPrimary: true
    }]
  }
};

describe("satellite_admin authority", () => {
  it("maps the verified Member Hub sample to the existing local admin UUID", () => {
    expect(resolveSyncedRoleId(sampleContext, definitions, null, "identity")).toBe("admin-id");
    const signals = collectHubPermissionSignals(sampleContext);
    expect(signals.keys).toContain("satellite_admin");
    expect(signals.keys).toContain("small_group_leader");
  });

  it("does not grant satellite admin before membership approval", () => {
    const context = { ...sampleContext, membershipState: "pending" };
    expect(resolveSyncedRoleId(context, definitions, null, "identity")).toBe("group-id");
    expect(collectHubPermissionSignals(context).keys).not.toContain("satellite_admin");
  });

  it("requires satellite_admin in the actual roles array, not only primaryRole", () => {
    const context = { ...sampleContext, roles: ["member"] };
    expect(resolveSyncedRoleId(context, definitions, null, "identity")).toBe("group-id");
    expect(collectHubPermissionSignals(context).satelliteAdminVerified).toBe(false);
  });

  it("does not invent satellite admin from apps or display labels", () => {
    const context = {
      membershipState: "approved",
      roles: ["member"],
      primaryRole: "member",
      leadershipIdentity: { displayLabel: "系統管理員", assignments: [] },
      apps: [{ id: "member-hub", access: "allowed" }]
    };
    expect(resolveSyncedRoleId(context, definitions, null, "identity")).toBe("member-id");
  });

  it("keeps email-only account linking unable to grant admin", () => {
    expect(resolveSyncedRoleId(sampleContext, definitions, null, "email")).toBe("10000000-0000-4000-8000-000000000001");
  });

  it("adds the Hub alias without creating a second local role", () => {
    expect(migration).toContain("ARRAY['satellite_admin']");
    expect(migration).toContain("WHERE code = 'admin'");
    expect(migration).not.toContain("'satellite_admin', '");
    expect(migration).toContain("public.role_code(profile.role_id)");
  });

  it("validates the Member Hub envelope and accepts assignments without assignmentId", () => {
    expect(sessionEdge).toContain("memberResponse?.ok === true");
    expect(sessionEdge).toContain('typeof memberResponse.context === "object"');
    expect(sessionEdge).toContain(".filter((assignment: any) => assignment.identityKey)");
  });

  it("shows application admin authority separately from church leadership identity", () => {
    expect(html).toContain('id="profile-summary-leadership"');
    expect(profile).toContain('role === "admin"');
    expect(profile).toContain("服事：");
  });
});
