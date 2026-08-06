import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("admin panel tab persistence tests", () => {
  it("verifies setAdminPrimaryPanel persists selected_admin_panel to sessionStorage", () => {
    const adminJs = readFileSync("js/modules/admin.js", "utf8");
    expect(adminJs).toContain("sessionStorage.setItem('selected_admin_panel', requested)");
  });

  it("verifies renderAdminPlanManagement restores savedPanel from sessionStorage", () => {
    const adminJs = readFileSync("js/modules/admin.js", "utf8");
    expect(adminJs).toContain("sessionStorage.getItem('selected_admin_panel')");
    expect(adminJs).not.toContain("setAdminPrimaryPanel('plans');\n    mountPlanManagementSections()");
  });
});
