import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = relativePath => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

describe("admin participant basic information", () => {
  it("carries existing profile fields into the participant view", () => {
    const db = read("js/db.js");
    const plan = read("js/modules/plan.js");

    expect(db).toContain('name, email, great_region, pastoral_zone, small_group');
    expect(db).toContain('email: profile.email || ""');
    expect(plan).toContain('email: u.email || ""');
    expect(plan).toContain('greatRegion: u.great_region || ""');
    expect(plan).toContain('pastoralZone: u.pastoral_zone || ""');
    expect(plan).toContain('smallGroup: u.small_group || ""');
    expect(plan).toContain("roleLabel:");
  });

  it("shows escaped basic details only to system administrators", () => {
    const plan = read("js/modules/plan.js");
    const css = read("index.css");

    expect(plan).toContain('const _isSystemAdmin = _careRole === "admin"');
    expect(plan).toContain('aria-label="參與者基本資料"');
    expect(plan).toContain('escapeHTML(participantEmail || "未提供電子信箱")');
    expect(plan).toContain("escapeHTML(participantOrganization)");
    expect(plan).toContain("escapeHTML(participantRole)");
    expect(css).toContain(".admin-participant-basic");
  });
});
