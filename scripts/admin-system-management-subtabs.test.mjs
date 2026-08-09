import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const html = read("index.html");
const admin = read("js/modules/admin.js");

describe("system management: category sub-tabs", () => {
  it("puts a shared 功能開放設定 card above a 4-button tab bar, inside admin-system-panel", () => {
    const panelStart = html.indexOf('id="admin-system-panel"');
    const panelEnd = html.indexOf('id="admin-plans-panel"', panelStart);
    const panel = html.slice(panelStart, panelEnd);

    expect(panel).toContain("功能開放設定");
    expect(panel).toContain('id="admin-system-subtabs"');

    const subtabs = [
      ["users", "使用者基本資料"],
      ["permissions", "權限管理"],
      ["registrations", "報名註冊統計"],
      ["reports", "回報管理"]
    ];
    for (const [key, label] of subtabs) {
      expect(panel).toContain(`data-system-subtab="${key}"`);
      expect(panel).toContain(`id="admin-system-subtab-${key}"`);
      expect(panel).toContain(label);
    }

    // 功能開放設定 and the tab bar must precede every subtab panel.
    const featureSettingsIndex = panel.indexOf("功能開放設定");
    const tabsIndex = panel.indexOf('id="admin-system-subtabs"');
    expect(tabsIndex).toBeGreaterThan(featureSettingsIndex);
    for (const [key] of subtabs) {
      expect(panel.indexOf(`id="admin-system-subtab-${key}"`)).toBeGreaterThan(tabsIndex);
    }
  });

  it("groups each existing section under the right category tab", () => {
    const panelStart = html.indexOf('id="admin-system-panel"');
    const panelEnd = html.indexOf('id="admin-plans-panel"', panelStart);
    const panel = html.slice(panelStart, panelEnd);

    const usersStart = panel.indexOf('id="admin-system-subtab-users"');
    const permissionsStart = panel.indexOf('id="admin-system-subtab-permissions"');
    const registrationsStart = panel.indexOf('id="admin-system-subtab-registrations"');
    const reportsStart = panel.indexOf('id="admin-system-subtab-reports"');

    const usersSection = panel.slice(usersStart, permissionsStart);
    const permissionsSection = panel.slice(permissionsStart, registrationsStart);
    const registrationsSection = panel.slice(registrationsStart, reportsStart);
    const reportsSection = panel.slice(reportsStart);

    expect(usersSection).toContain('id="admin-user-directory-col"');
    // 組織架構權限總覽 + 管理範圍設定 both live under 權限管理.
    expect(permissionsSection).toContain('id="admin-org-permissions-col"');
    expect(permissionsSection).toContain('id="admin-managed-scopes-col"');
    expect(registrationsSection).toContain('id="admin-registration-statistics-col"');
    expect(reportsSection).toContain('id="admin-reports-root"');
  });

  it("fixes the 報名與註冊統計 card's mislabeled 權限管理 eyebrow", () => {
    const cardStart = html.indexOf('id="admin-registration-statistics-col"');
    const cardEnd = html.indexOf("</section>", cardStart);
    const card = html.slice(cardStart, cardEnd);
    expect(card).toContain('<p class="admin-registration-statistics__eyebrow">報名註冊統計</p>');
    expect(card).not.toContain('<p class="admin-registration-statistics__eyebrow">權限管理</p>');
  });

  it("wires tab-switching in admin.js, mirroring the 計畫管理 4-tab pattern", () => {
    expect(admin).toContain("const ADMIN_SYSTEM_SUBTABS = ['users', 'permissions', 'registrations', 'reports'];");
    expect(admin).toContain("function setAdminSystemSubtab(subtab)");
    expect(admin).toContain("function initAdminSystemSubtabs()");
    expect(admin).toContain("'selected_admin_system_subtab'");
    expect(admin).toContain("#admin-system-subtabs [data-system-subtab]");

    const initStart = admin.indexOf("export function init()");
    const initEnd = admin.indexOf("\n}", initStart);
    const initBody = admin.slice(initStart, initEnd);
    expect(initBody).toContain("initAdminSystemSubtabs();");
  });
});
