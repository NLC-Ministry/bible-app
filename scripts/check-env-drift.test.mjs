import { describe, expect, it } from "vitest";
import {
  COMMENT_MARKER,
  ENVIRONMENTS,
  collectFunctionFiles,
  diffFunctions,
  diffMigrations,
  findRelativeImports,
  parseArgs,
  parseMigrationFiles,
  renderReport
} from "./check-env-drift.mjs";

// #593：repo 的 migration／Edge Function 是否已經到了 staging／正式站。

describe("parseMigrationFiles", () => {
  it("keeps only timestamp files, sorted, ignoring legacy/", () => {
    expect(parseMigrationFiles([
      "supabase/migrations/20261019094508_b.sql",
      "supabase/migrations/20261019035001_a.sql",
      "supabase/migrations/0001_old.sql",
      "supabase/migrations/README.md"
    ])).toEqual([
      { version: "20261019035001", file: "20261019035001_a.sql" },
      { version: "20261019094508", file: "20261019094508_b.sql" }
    ]);
  });
});

describe("diffMigrations", () => {
  const local = parseMigrationFiles(["20261001000000_a.sql", "20261002000000_b.sql", "20261003000000_c.sql"]);

  it("lists migrations the environment has not applied", () => {
    const diff = diffMigrations(local, ["20261001000000"]);
    expect(diff.pending.map(m => m.file)).toEqual(["20261002000000_b.sql", "20261003000000_c.sql"]);
    expect(diff.remoteOnly).toEqual([]);
  });

  it("reports timestamp versions only the environment has, ignoring pre-timestamp ones", () => {
    const diff = diffMigrations(local, ["0001", "0214", "20261001000000", "20261002000000", "20261003000000", 20260901000000]);
    expect(diff.pending).toEqual([]);
    expect(diff.remoteOnly).toEqual(["20260901000000"]);
  });
});

describe("collectFunctionFiles", () => {
  const tree = {
    "supabase/functions/nlc-data/index.ts": 'import { a } from "./plan-report.ts";\nimport x from "npm:zod";',
    "supabase/functions/nlc-data/plan-report.ts": 'export { r } from "../_shared/progress/plan-report.mjs";',
    "supabase/functions/_shared/progress/plan-report.mjs": 'import { B } from "./bible-chapters.mjs";',
    "supabase/functions/_shared/progress/bible-chapters.mjs": "export const B = 1;",
    "supabase/functions/_shared/progress/unused.mjs": "export const U = 1;"
  };
  const deps = {
    listFiles: dir => Object.keys(tree).filter(path => path.startsWith(`${dir}/`)),
    readFile: path => tree[path] ?? null
  };

  it("follows relative imports out of the function folder, transitively", () => {
    expect(collectFunctionFiles("nlc-data", deps)).toEqual([
      "supabase/functions/_shared/progress/bible-chapters.mjs",
      "supabase/functions/_shared/progress/plan-report.mjs",
      "supabase/functions/nlc-data/index.ts",
      "supabase/functions/nlc-data/plan-report.ts"
    ]);
  });

  it("finds static, re-export and dynamic imports", () => {
    expect(findRelativeImports('import a from "./a.ts"; export * from \'../b.mjs\'; await import("./c.ts"); import "npm:x";'))
      .toEqual(["./a.ts", "../b.mjs", "./c.ts"]);
  });
});

describe("diffFunctions", () => {
  const changedAt = Date.parse("2026-10-19T10:00:00+08:00");
  const local = [
    { name: "nlc-data", commit: "abc1234", changedAt },
    { name: "admin-api", commit: "def5678", changedAt },
    { name: "exam-write", commit: "0000000", changedAt }
  ];
  const remote = [
    { slug: "nlc-data", updated_at: Date.parse("2026-10-16T09:00:00+08:00"), version: 176 },
    { slug: "admin-api", updated_at: Date.parse("2026-10-19T11:00:00+08:00"), version: 40 },
    { slug: "old-fn", updated_at: 0, version: 1 }
  ];

  it("flags functions deployed before the repo's last change, missing ones, and remote-only ones", () => {
    const diff = diffFunctions(local, remote);
    expect(diff.stale.map(fn => [fn.name, fn.version])).toEqual([["nlc-data", 176]]);
    expect(diff.missing.map(fn => fn.name)).toEqual(["exam-write"]);
    expect(diff.ok.map(fn => fn.name)).toEqual(["admin-api"]);
    expect(diff.remoteOnly).toEqual(["old-fn"]);
  });
});

describe("renderReport", () => {
  const changedAt = Date.parse("2026-10-19T10:00:00+08:00");
  const pending = { pending: [{ version: "20261019035001", file: "20261019035001_a.sql" }], remoteOnly: [] };
  const stale = {
    stale: [{ name: "nlc-data", commit: "abc1234", changedAt, deployedAt: Date.parse("2026-10-16T09:00:00+08:00"), version: 176 }],
    missing: [], remoteOnly: [], ok: []
  };
  const clean = { pending: [], remoteOnly: [] };
  const fresh = { stale: [], missing: [], remoteOnly: [], ok: [] };

  it("marks staging gaps red and lists production gaps as release steps", () => {
    const report = renderReport({
      gitRef: "origin/staging", commit: "ce4f4f2", checkedAt: changedAt, prNumber: 605,
      results: [
        { env: ENVIRONMENTS.staging, migrations: pending, functions: stale },
        { env: ENVIRONMENTS.production, migrations: pending, functions: stale }
      ]
    });
    expect(report.startsWith(COMMENT_MARKER)).toBe(true);
    expect(report).toContain("🔴 Migration 還沒套用 1 支");
    expect(report).toContain("🔴 需要重新部署");
    expect(report).toContain("資料庫要更新的項目：");
    expect(report).toContain("要重新部署的 Edge Function：");
    expect(report).toContain("`nlc-data`：部署於 2026-10-16 09:00（v176），repo 最後修改 2026-10-19 10:00（abc1234）");
    expect(report).toContain("--pr 605");
  });

  it("says so when an environment is up to date", () => {
    const report = renderReport({
      gitRef: "origin/staging", commit: "ce4f4f2", checkedAt: changedAt,
      results: [{ env: ENVIRONMENTS.staging, migrations: clean, functions: fresh }]
    });
    expect(report).toContain("Migration：✅ 全部已套用");
    expect(report).toContain("Edge Function：✅");
    expect(report).not.toContain("🔴");
  });
});

describe("parseArgs", () => {
  it("defaults to both environments against origin/staging", () => {
    expect(parseArgs([])).toEqual({ gitRef: "origin/staging", envs: ["staging", "production"], prNumber: null });
  });

  it("accepts --env, --ref and --pr", () => {
    expect(parseArgs(["--env", "staging", "--ref", "origin/main", "--pr", "605"]))
      .toEqual({ gitRef: "origin/main", envs: ["staging"], prNumber: 605 });
  });

  it("rejects unknown input", () => {
    expect(() => parseArgs(["--env", "prod"])).toThrow();
    expect(() => parseArgs(["--pr", "abc"])).toThrow();
    expect(() => parseArgs(["--run"])).toThrow();
  });
});
