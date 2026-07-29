import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(root, rel), "utf8");

const html = read("index.html");
const stateJs = read("js/state.js");
const utilsJs = read("js/utils.js");
const profileJs = read("js/modules/profile.js");
const dbJs = read("js/db.js");
const authJs = read("js/auth.js");
const appJs = read("js/app.js");
const nlcSession = read("supabase/functions/nlc-session/index.ts");
const copyJs = read("js/copy/zh-Hant.js");

describe("No invented display-name fallbacks", () => {
  it("does not ship static 新使用者 on the profile name", () => {
    expect(html).not.toMatch(/id="profile-summary-name"[^>]*>\s*新使用者/);
    expect(html).toMatch(/id="profile-summary-name"[^>]*aria-busy="true"/);
  });

  it("defines getDisplayName and rejects known invented placeholders", () => {
    expect(utilsJs).toContain("function getDisplayName");
    expect(utilsJs).toContain("INVENTED_DISPLAY_NAMES");
    expect(utilsJs).toContain("新使用者");
    expect(utilsJs).toContain("NLC User");
    expect(utilsJs).toContain("function isMemberContextPending");
  });

  it("does not invent names in apply/create/auth/session paths", () => {
    expect(profileJs).not.toMatch(/\|\|\s*["']新使用者["']/);
    expect(profileJs).not.toMatch(/\|\|\s*["']NLC User["']/);
    expect(dbJs).not.toMatch(/\|\|\s*["']NLC User["']/);
    expect(dbJs).not.toMatch(/\|\|\s*["']新使用者["']/);
    expect(dbJs).not.toMatch(/name:\s*["']訪客["']/);
    expect(authJs).not.toMatch(/\|\|\s*["']NLC User["']/);
    expect(nlcSession).not.toMatch(/firstValue\([^)]*["']NLC User["']/);
  });

  it("neutralizes demo state.currentUser identity defaults", () => {
    expect(stateJs).not.toMatch(/name:\s*["']系統管理員["']/);
    expect(stateJs).not.toMatch(/great_region:\s*["']東區["']/);
    expect(stateJs).not.toMatch(/pastoral_zone:\s*["']大安1["']/);
    expect(stateJs).not.toMatch(/small_group:\s*["']馬鈴["']/);
    expect(stateJs).toContain("profileIdentityLoading");
  });
});

describe("Profile identity skeleton lifecycle", () => {
  it("keeps placement grid on skeleton markup before sync settles", () => {
    expect(html).toMatch(/id="member-hub-org-great-region"[^>]*aria-busy="true"/);
    expect(html).not.toMatch(/id="member-hub-org-great-region">尚未設定</);
  });

  it("gates org placement on pending vs settled empty", () => {
    expect(profileJs).toContain("isMemberContextPending");
    expect(profileJs).toContain("placement-value");
    expect(profileJs).toContain("尚未設定");
    expect(profileJs).toContain("applyProfileIdentitySkeletons");
    expect(profileJs).toContain("paintProfileIdentityChrome");
  });

  it("does not restore invented boot HTML when clearing inline skeletons", () => {
    expect(utilsJs).toContain("clearBootInlineSkeletons");
    expect(utilsJs).toContain("paintProfileIdentityChrome");
    expect(utilsJs).not.toMatch(/clearBootInlineSkeletons\(\)\s*\{[^}]*restoreInlineSkeleton\("#profile-summary-name"\)/s);
  });

  it("shows skeletons during profile-tab force sync", () => {
    expect(appJs).toContain("profileIdentityLoading = true");
    expect(appJs).toContain("applyProfileIdentitySkeletons");
    expect(appJs).toContain("profileIdentityLoading = false");
  });

  it("exposes approved empty name copy after sync", () => {
    expect(copyJs).toContain("nameUnset");
    expect(copyJs).toContain("尚未取得姓名");
    expect(profileJs).toContain("nameUnset");
  });
});
