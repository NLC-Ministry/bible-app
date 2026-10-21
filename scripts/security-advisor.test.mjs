import { describe, expect, it } from "vitest";
import { classifyFindings, parseArgs, renderFindings } from "./security-advisor.mjs";

// #594：Security Advisor（Splinter）結果只留資安類，依允許清單分類。

const finding = (name, cacheKey, categories = ["SECURITY"]) => ({
  name, cache_key: cacheKey, categories, level: "WARN",
  detail: `Table \\\`public.${cacheKey}\\\` has an issue`, remediation: "https://supabase.com/docs"
});

describe("classifyFindings", () => {
  const allowlist = {
    lints: { rls_enabled_no_policy: "只給 service_role" },
    cache_keys: { "security_definer_view_public_v1": "刻意的 view" }
  };

  it("drops non-security lints and splits by allowlist (lint name or cache_key)", () => {
    const { accepted, unexpected } = classifyFindings([
      finding("unindexed_foreign_keys", "fk1", ["PERFORMANCE"]),
      finding("rls_enabled_no_policy", "t1"),
      finding("security_definer_view", "security_definer_view_public_v1"),
      finding("security_definer_view", "security_definer_view_public_v2")
    ], allowlist);
    expect(accepted.map(row => [row.cache_key, row.reason])).toEqual([
      ["t1", "只給 service_role"],
      ["security_definer_view_public_v1", "刻意的 view"]
    ]);
    expect(unexpected.map(row => row.cache_key)).toEqual(["security_definer_view_public_v2"]);
  });

  it("treats everything as unexpected without an allowlist", () => {
    expect(classifyFindings([finding("rls_disabled_in_public", "t")]).unexpected).toHaveLength(1);
  });
});

describe("renderFindings", () => {
  it("lists findings to handle and summarizes accepted ones per lint", () => {
    const text = renderFindings({
      envLabel: "staging", ref: "aaaaaaaaaaaaaaaaaaaa",
      unexpected: [finding("rls_disabled_in_public", "t2")],
      accepted: [{ ...finding("rls_enabled_no_policy", "t1"), reason: "只給 service_role" }]
    });
    expect(text).toContain("🔴 要處理 1 項");
    expect(text).toContain("`rls_disabled_in_public`：Table `public.t2` has an issue");
    expect(text).toContain("`rls_enabled_no_policy` × 1：只給 service_role");
  });

  it("says so when nothing needs handling", () => {
    expect(renderFindings({ envLabel: "staging", ref: "x", unexpected: [], accepted: [] })).toContain("✅");
  });
});

describe("parseArgs", () => {
  it("defaults to staging and only accepts known environments", () => {
    expect(parseArgs([])).toEqual({ env: "staging" });
    expect(parseArgs(["--env", "production"])).toEqual({ env: "production" });
    expect(() => parseArgs(["--env", "prod"])).toThrow();
  });
});
