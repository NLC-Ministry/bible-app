import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  EXPECTED_DIFFERENCE_SECTIONS,
  PROD_REF,
  STAGING_REF,
  diffSnapshots,
  formatReport,
  parseSnapshot
} from "./compare-env-snapshots.mjs";

// #266：比對正式環境和 staging 的 environment_consistency_check.sql 輸出。
const sql = readFileSync(
  new URL("../supabase/queries/environment_consistency_check.sql", import.meta.url),
  "utf8"
);

const row = (section, object, detail) => ({ section, object, detail });

describe("environment_consistency_check.sql", () => {
  it("is read-only", () => {
    const statements = sql
      .split(/\r?\n/)
      .filter(line => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i);
    // Vault 只列名稱，絕不讀 decrypted_secret
    expect(statements).not.toMatch(/decrypted_secret/);
  });

  it("covers every section the comparison relies on", () => {
    for (const section of [
      "extension", "extension_version", "table", "column", "constraint", "index", "trigger", "view",
      "policy", "table_grant", "function", "function_grant", "enum", "default_acl",
      "storage_bucket", "cron_job", "vault_secret_name"
    ]) {
      expect(sql).toContain(`'${section}'`);
    }
  });

  it("orders output deterministically", () => {
    expect(sql).toMatch(/ORDER BY section, object, detail;\s*$/);
  });
});

describe("parseSnapshot", () => {
  it("reads `supabase db query` JSON, skipping CLI log lines before it", () => {
    const text = 'Initialising login role...\n{"boundary":"x","rows":[{"section":"table","object":"profiles","detail":"kind=r rls=true force_rls=false"}],"warning":"untrusted"}';
    expect(parseSnapshot(text)).toEqual([row("table", "profiles", "kind=r rls=true force_rls=false")]);
  });

  it("reads SQL Editor CSV with quoted commas, quotes and newlines", () => {
    const text = '﻿section,object,detail\r\npolicy,public.a.p,"cmd=SELECT using=(x = ANY (ARRAY[1, 2]))\nand ""y"""\r\ntable,a,kind=r\r\n';
    expect(parseSnapshot(text)).toEqual([
      row("policy", "public.a.p", 'cmd=SELECT using=(x = ANY (ARRAY[1, 2]))\nand "y"'),
      row("table", "a", "kind=r")
    ]);
  });

  it("fails loudly on a CLI error instead of reporting an empty snapshot", () => {
    expect(() => parseSnapshot('{"_tag":"Error","rows":null}')).toThrow(/rows/);
  });
});

describe("diffSnapshots", () => {
  const prod = [
    row("function", "public.f()", "md5=aaa"),
    row("function_grant", "public.f()", "anon=false"),
    row("table", "t", "rls=true"),
    row("cron_job", "sweep", "*/5 * * * *"),
    row("extension_version", "pg_net", "0.20.3")
  ];

  it("reports nothing when the snapshots match", () => {
    expect(diffSnapshots(prod, [...prod].reverse())).toEqual({ unexpected: [], expected: [] });
  });

  it("classifies missing and changed objects as unexpected", () => {
    const staging = [
      row("function", "public.f()", "md5=bbb"),
      row("function_grant", "public.f()", "anon=false"),
      row("table", "t2", "rls=true"),
      row("cron_job", "sweep", "*/5 * * * *"),
      row("extension_version", "pg_net", "0.20.3")
    ];
    const { unexpected, expected } = diffSnapshots(prod, staging);
    expect(expected).toEqual([]);
    expect(unexpected.map(d => [d.section, d.object, d.kind])).toEqual([
      ["function", "public.f()", "changed"],
      ["table", "t", "only_in_a"],
      ["table", "t2", "only_in_b"]
    ]);
  });

  it("keeps cron jobs, vault names and extension versions out of the failing set", () => {
    const staging = [
      row("function", "public.f()", "md5=aaa"),
      row("function_grant", "public.f()", "anon=false"),
      row("table", "t", "rls=true"),
      row("extension_version", "pg_net", "0.20.4"),
      row("vault_secret_name", "project_url", "-")
    ];
    const { unexpected, expected } = diffSnapshots(prod, staging);
    expect(unexpected).toEqual([]);
    expect(expected.map(d => d.section)).toEqual(["cron_job", "extension_version", "vault_secret_name"]);
    expect([...EXPECTED_DIFFERENCE_SECTIONS].sort()).toEqual(["cron_job", "extension_version", "vault_secret_name"]);
  });

  it("flags an anon grant difference as unexpected", () => {
    const staging = prod.map(r => (r.section === "function_grant" ? row(r.section, r.object, "anon=true") : r));
    const { unexpected } = diffSnapshots(prod, staging);
    expect(unexpected).toHaveLength(1);
    expect(formatReport({ unexpected, expected: [] })).toContain("❌ 1 項非預期差異");
  });
});

describe("--run targets", () => {
  it("uses the documented project refs", () => {
    expect(PROD_REF).toBe("ztozevcqkfrohgjmngcj");
    expect(STAGING_REF).toBe("vzokpsscyivhgmhleplq");
  });
});
