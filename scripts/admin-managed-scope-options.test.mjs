import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildManagedScopeChoices, managedScopeErrorMessage } from "../js/modules/admin-managed-scope-options.mjs";

const zones = [{ name: "信義牧區" }, { name: "大安牧區" }];

describe("managed scope editor choices (#459)", () => {
  it("pre-checks only names that exist in the org structure", () => {
    const result = buildManagedScopeChoices(zones, ["大安牧區", "信議牧區", " "]);
    expect(result.selected).toEqual(["大安牧區"]);
    expect(result.dropped).toEqual(["信議牧區"]);
  });

  it("never offers a stale stored name as a checkbox, so saving cannot send it", () => {
    const { optionNames } = buildManagedScopeChoices(zones, ["舊牧區"]);
    expect(optionNames).not.toContain("舊牧區");
    expect(optionNames).toEqual(["大安牧區", "信義牧區"].sort((a, b) => a.localeCompare(b, "zh-Hant")));
  });

  it("matches trimmed placement names", () => {
    expect(buildManagedScopeChoices(zones, ["信義牧區 "]).selected).toEqual(["信義牧區"]);
  });

  it("offers nothing when the org structure failed to load", () => {
    expect(buildManagedScopeChoices([], ["信義牧區"])).toEqual({ optionNames: [], selected: [], dropped: ["信義牧區"] });
  });

  it("translates server error codes to Chinese", () => {
    expect(managedScopeErrorMessage({ message: "managed_scope_unknown_zone" })).toContain("牧區名稱不在組織名單中");
    expect(managedScopeErrorMessage({ message: "network down" })).toBe("network down");
    expect(managedScopeErrorMessage(null)).toBe("儲存失敗。");
  });

  it("admin editor uses the shared choices and blocks saving with an empty option list", () => {
    const admin = readFileSync(new URL("../js/modules/admin.js", import.meta.url), "utf8");
    expect(admin).toContain("buildManagedScopeChoices(config.options, defaultScopes)");
    expect(admin).toContain("save.disabled = !config.field || optionNames.length === 0;");
    expect(admin).toContain("managedScopeErrorMessage(updateResult.error)");
  });
});
