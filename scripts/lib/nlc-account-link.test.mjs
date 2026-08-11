import { describe, it, expect } from "vitest";
import { MEMBER_ROLE_ID, resolveSyncedRoleId } from "./nlc-account-link.mjs";

const ADMIN_ROLE_ID = "10000000-0000-4000-8000-000000000006";
const PASTOR_ROLE_ID = "10000000-0000-4000-8000-000000000005";
const definitions = [
  { id: ADMIN_ROLE_ID, code: "admin", label: "系統管理員", hub_permission_keys: ["system_admin"], hub_permission_labels: ["管理員"] },
  { id: PASTOR_ROLE_ID, code: "pastor", label: "牧者", hub_permission_keys: ["church_pastor"], hub_permission_labels: ["主任牧師"] }
];

describe("resolveSyncedRoleId — Member Hub authority and account-link strength", () => {
  it("maps a stable Hub identity key to its role UUID on a strong link", () => {
    const context = { leadershipIdentity: { assignments: [{ identityKey: "system_admin" }] } };
    expect(resolveSyncedRoleId(context, definitions, null, "identity")).toBe(ADMIN_ROLE_ID);
  });

  it("uses labels only as a fallback and supports renamed local labels", () => {
    const context = { leadershipIdentity: { displayLabel: "主任牧師", assignments: [] } };
    expect(resolveSyncedRoleId(context, definitions, null, "member_id")).toBe(PASTOR_ROLE_ID);
  });

  it("never grants or inherits privilege through an email-only link", () => {
    const context = { primaryRole: "admin", leadershipIdentity: { assignments: [] } };
    expect(resolveSyncedRoleId(context, definitions, ADMIN_ROLE_ID, "email")).toBe(MEMBER_ROLE_ID);
  });

  it("preserves the existing UUID only while Member Hub context is degraded", () => {
    expect(resolveSyncedRoleId(null, definitions, PASTOR_ROLE_ID, "identity")).toBe(PASTOR_ROLE_ID);
  });

  it("falls back to member for an authoritative context with no mapped label", () => {
    const context = { leadershipIdentity: { assignments: [{ identityKey: "unknown" }] } };
    expect(resolveSyncedRoleId(context, definitions, PASTOR_ROLE_ID, "identity")).toBe(MEMBER_ROLE_ID);
  });
});