// App → 後台的固定連結（#555）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ADMIN_CONSOLE_SECTION_ROUTES,
  ADMIN_CONSOLE_URL,
  adminConsoleBase,
  adminConsoleSectionUrl,
  adminConsoleUserUrl
} from "../js/admin-console-link.mjs";
import { DEFAULT_ADMIN_ORIGINS } from "../supabase/functions/admin-api/policy.ts";
import { parseRoute } from "../admin/src/route.ts";
import { LEGACY_SECTION_TABS } from "../js/modules/pastoral-metrics.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab";

describe("adminConsoleUserUrl", () => {
  it("production app links to the production console, everything else to staging", () => {
    expect(adminConsoleBase("bible.newlife.org.tw")).toBe("https://bible-speed-reading-admin.vercel.app");
    expect(adminConsoleBase("bible-speed-reading-staging.vercel.app")).toBe("https://bible-speed-reading-admin-staging.vercel.app");
    expect(adminConsoleBase("localhost")).toBe("https://bible-speed-reading-admin-staging.vercel.app");
  });

  it("opens the person directly with the view reason", () => {
    expect(adminConsoleUserUrl(ID.toUpperCase(), { reason: "因回報 abc", hostname: "bible.newlife.org.tw" }))
      .toBe(`https://bible-speed-reading-admin.vercel.app/#/people/user/${ID}?${new URLSearchParams({ reason: "因回報 abc" })}`);
    expect(adminConsoleUserUrl(ID, { hostname: "localhost" })).toBe(`https://bible-speed-reading-admin-staging.vercel.app/#/people/user/${ID}`);
  });

  it("returns null for anything that is not a user id", () => {
    expect(adminConsoleUserUrl(undefined)).toBeNull();
    expect(adminConsoleUserUrl("../evil")).toBeNull();
  });

  it("uses the same console URLs admin-api allows (CORS)", () => {
    expect(Object.values(ADMIN_CONSOLE_URL).sort()).toEqual([...DEFAULT_ADMIN_ORIGINS].sort());
  });
});

describe("legacy report management links each reporter to the console", () => {
  it("the admin report list returns the reporter id (migration) and the table renders the link", () => {
    const migration = readFileSync(join(root, "supabase", "migrations", "20261011113737_issue_admin_list_reporter_id.sql"), "utf8");
    expect(migration).toMatch(/'reporter', CASE WHEN p\.id IS NULL THEN NULL ELSE jsonb_build_object\(\s*'id', p\.id,/);
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.issue_admin_thread_list(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;");
    const view = readFileSync(join(root, "components", "issue-report", "AdminReportView.tsx"), "utf8");
    expect(view).toContain("id: row.reporter.id");
    const table = readFileSync(join(root, "components", "issue-report", "AdminReportTable.tsx"), "utf8");
    expect(table).toContain("adminConsoleUserUrl(report.profiles?.id");
    expect(table).toContain('rel="noopener noreferrer"');
    expect(table).toContain("在後台查看此使用者");
  });
});

// #551：系統管理功能只在後台。舊的 App 管理分頁網址（#/admin/<區塊>）要嘛導到後台那一區，
// 要嘛對到 App 管理分頁（組長用）的某個分頁，兩邊不重疊、不漏。
describe("old #/admin/<section> links after the 管理 tab split (#551)", () => {
  const adminJs = readFileSync(join(root, "js", "modules", "admin.js"), "utf8");
  const oldSections = [...adminJs.matchAll(/\{ id: '([a-z-]+)',\s+group:/g)].map((m) => m[1]);

  it("every old section either opens in the console or maps to a leader tab, never both", () => {
    expect(oldSections.length).toBeGreaterThan(10);
    for (const id of oldSections) {
      const console = Object.hasOwn(ADMIN_CONSOLE_SECTION_ROUTES, id);
      const leader = Object.hasOwn(LEGACY_SECTION_TABS, id);
      expect(console !== leader, id).toBe(true);
    }
  });

  it("each console target is a real console page, not its not-found fallback", () => {
    for (const [id, hash] of Object.entries(ADMIN_CONSOLE_SECTION_ROUTES)) {
      expect(parseRoute(hash).view, id).not.toBe("not_found");
    }
    expect(parseRoute(ADMIN_CONSOLE_SECTION_ROUTES["lightning-quiz"])).toEqual({ view: "legacy", area: "content", section: "lightning-quiz" });
    expect(parseRoute(ADMIN_CONSOLE_SECTION_ROUTES.settings)).toEqual({ view: "legacy", area: "system", section: "settings" });
    expect(parseRoute(ADMIN_CONSOLE_SECTION_ROUTES.permissions)).toMatchObject({ view: "people", tab: "scopes" });
  });

  it("builds the URL on the right console, and nothing for leader sections", () => {
    // #565：計畫管理在後台計畫區的「計畫設定」
    expect(adminConsoleSectionUrl("plans", { hostname: "bible.newlife.org.tw" })).toBe("https://bible-speed-reading-admin.vercel.app/#/plans/settings");
    expect(parseRoute(ADMIN_CONSOLE_SECTION_ROUTES.plans)).toEqual({ view: "legacy", area: "plans", section: "plans" });
    expect(adminConsoleSectionUrl("reports", { hostname: "localhost" })).toBe("https://bible-speed-reading-admin-staging.vercel.app/#/support");
    expect(adminConsoleSectionUrl("teams", { hostname: "localhost" })).toBeNull();
    expect(adminConsoleSectionUrl("__proto__", { hostname: "localhost" })).toBeNull();
    expect(adminConsoleSectionUrl(undefined, { hostname: "localhost" })).toBeNull();
  });
});

describe("個人頁「開啟管理後台」 (#551)", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const profile = readFileSync(join(root, "js", "modules", "profile.js"), "utf8");

  it("is one hidden row that opens the console in a new tab", () => {
    const start = html.indexOf('id="profile-admin-console-group"');
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(html.lastIndexOf("<", start), start)).toMatch(/hidden/);
    const entry = html.slice(html.indexOf('id="profile-admin-console-entry"') - 200, html.indexOf('id="profile-admin-console-entry"') + 200);
    expect(entry).toContain('target="_blank"');
    expect(entry).toContain('rel="noopener"');
  });

  it("only the system administrator gets it, pointing at this environment's console", () => {
    const start = profile.indexOf("function renderAdminConsoleEntry()");
    const body = profile.slice(start, profile.indexOf("export async function renderProfileView", start));
    expect(body).toMatch(/=== ["']admin["']/);
    expect(body).toContain("adminConsoleBase(");
    expect(profile).toContain("renderAdminConsoleEntry();");
  });
});
