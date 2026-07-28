import { describe, expect, it } from "vitest";
import fs from "node:fs";

const dbSource = fs.readFileSync("js/db.js", "utf8");
const authSource = fs.readFileSync("js/auth.js", "utf8");
const stateSource = fs.readFileSync("js/state.js", "utf8");

describe("member context frontend sync metadata", () => {
  it("copies member_context_synced_at from the projected profile into state.currentUser", () => {
    expect(dbSource).toMatch(/state\.currentUser\.member_context_synced_at\s*=\s*profile\.member_context_synced_at\s*\|\|\s*""/);
  });

  it("preserves member_context_synced_at in the cached nlc profile payload", () => {
    expect(dbSource).toMatch(/localStorage\.setItem\("nlc_supabase_profile",\s*JSON\.stringify\(payload\.profile\)\)/);
  });

  it("forces a fresh Logto access token when manually refreshing Member Hub context", () => {
    expect(dbSource).toMatch(/auth\.getValidAccessToken\(force\)/);
  });

  it("initializes member_context_synced_at for fresh and reset app state", () => {
    expect(stateSource).toContain('member_context_synced_at: ""');
    expect(authSource).toContain('member_context_synced_at: ""');
  });
});
