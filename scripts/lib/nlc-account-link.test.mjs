import { describe, it, expect } from "vitest";
import { resolveSyncedRole, PRIVILEGED_ROLES } from "./nlc-account-link.mjs";

// Security contract: privilege must never be granted or inherited via a WEAK
// (email-only) account link, because NLC identity can be phone-primary and the
// email in a token is not guaranteed to be verified/owned by the caller.
describe("resolveSyncedRole — privilege gating by link strength", () => {
  it("grants admin from Hub primaryRole ONLY on a strong (identity/member_id) link", () => {
    expect(resolveSyncedRole("admin", null, "identity")).toBe("admin");
    expect(resolveSyncedRole("admin", null, "member_id")).toBe("admin");
  });

  it("does NOT grant admin from primaryRole on a weak (email) link", () => {
    expect(resolveSyncedRole("admin", null, "email")).toBe("member");
  });

  it("does NOT inherit an existing privileged role on a weak (email) link (takeover guard)", () => {
    for (const role of PRIVILEGED_ROLES) {
      expect(resolveSyncedRole(null, role, "email")).toBe("member");
    }
  });

  it("preserves admin and church pastor on a strong link", () => {
    expect(resolveSyncedRole(null, "admin", "identity")).toBe("admin");
    expect(resolveSyncedRole(null, "senior_pastor", "member_id")).toBe("senior_pastor");
  });

  it("does not inherit the church-pastor role through a weak link", () => {
    expect(resolveSyncedRole(null, "senior_pastor", "email")).toBe("member");
  });

  it("preserves a non-privileged existing role even on a weak link (account continuity)", () => {
    expect(resolveSyncedRole(null, "member", "email")).toBe("member");
  });

  it("defaults to member when there is no existing role and no admin grant", () => {
    expect(resolveSyncedRole(null, null, "identity")).toBe("member");
    expect(resolveSyncedRole(null, "", "none")).toBe("member");
  });
});
