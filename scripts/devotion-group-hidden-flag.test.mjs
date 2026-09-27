import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// 2026-09-27：每日靈修／小組聚會的內容改在 staging 編輯與測試。
// 正式環境的 app_feature_settings.devotion_group_hidden 維持 TRUE（對所有人隱藏），
// staging 設為 FALSE；後台不再提供「完全隱藏（政策審核中）」開關，避免有人誤按
// 提前公開。政策通過要上線時，用 migration 改成 FALSE。見 docs/staging.md。
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const html = read("index.html");
const admin = read("js/modules/admin.js");
const db = read("js/db.js");
const home = read("js/modules/home.js");
const plan = read("js/modules/plan.js");

describe("devotion_group_hidden: read-only, no admin toggle", () => {
  it("has no toggle in the admin feature settings", () => {
    expect(html).not.toContain("admin-devotion-hidden-toggle");
    expect(html).not.toContain("完全隱藏（政策審核中）");
    expect(admin).not.toContain("admin-devotion-hidden-toggle");
    expect(admin).not.toContain("updateDevotionHiddenControl");
  });

  it("can't be changed through db.updateFeatureSetting any more", () => {
    const update = db.slice(db.indexOf("async updateFeatureSetting("), db.indexOf("if (!allowedKeys.has(key))", db.indexOf("async updateFeatureSetting(")));
    expect(update).not.toContain('"devotion_group_hidden"');
  });

  it("is still read and still hides both features everywhere when TRUE", () => {
    expect(db).toMatch(/FEATURE_SETTING_KEYS: \[[^\]]*"devotion_group_hidden"/);
    expect(admin).toContain('db.getFeatureSetting("devotion_group_hidden", false)');
    expect(admin).toContain('window.devotionGroupHidden !== true');
    expect(home).toContain('if (window.devotionGroupHidden === true) return false;');
    expect(plan).toContain('if (window.devotionGroupHidden === true) return false;');
  });
});
