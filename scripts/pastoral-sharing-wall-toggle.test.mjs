import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("index.css");
const db = read("js/db.js");
const home = read("js/modules/home.js");
const admin = read("js/modules/admin.js");
const edge = read("supabase/functions/nlc-data/index.ts");
const migration = read("supabase/migrations/0025_pastoral_sharing_wall_feature_flag.sql");

describe("pastoral sharing wall feature control", () => {
  it("archives the wall by default without deleting existing content", () => {
    expect(migration).toContain("'pastoral_sharing_wall'");
    expect(migration).toMatch(/'pastoral_sharing_wall',\s*FALSE/);
    expect(migration).not.toMatch(/DELETE FROM public\.devotional_/i);
    expect(html).toContain('id="pastoral-sharing-wall-card"');
    expect(html).toContain("sharing-wall-card span-12 mt-6 hidden");
  });

  it("only allows administrators to change the persisted setting", () => {
    expect(migration).toContain("app_feature_settings_manage_admin");
    expect(migration).toContain("my_role FROM public.get_my_profile()) = 'admin'");
    expect(edge).toContain('"app_feature_settings"');
    expect(edge).toContain("ADMIN_WRITE_TABLES");
    expect(db).toContain('state.currentUser.role !== "admin"');
  });

  it("prevents archived wall reads and writes through both auth paths", () => {
    expect(migration).toContain("public.is_feature_enabled('pastoral_sharing_wall')");
    expect(edge).toContain('return jsonResponse({ error: "feature_archived" }, 403)');
    expect(edge).toContain('if (action === "select") return jsonResponse({ data: [], profile })');
    expect(home).toContain("if (!pastoralSharingWallEnabled) return");
  });

  it("provides an accessible design-system switch in the admin page", () => {
    expect(html).toContain('id="admin-pastoral-wall-toggle"');
    expect(html).toContain('role="switch"');
    expect(admin).toContain("renderAdminFeatureSettings");
    expect(admin).toContain('"pastoral-sharing-wall-changed"');
    expect(css).toContain('.feature-switch[aria-checked="true"]');
  });
});
