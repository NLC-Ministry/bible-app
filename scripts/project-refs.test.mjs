// #609：project ref 從環境變數／.env 讀，不寫進 repo。
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { environmentOfRef, loadProjectRefs, parseDotEnv, requireProjectRef } from "./lib/project-refs.mjs";
import { ORIGIN_PLACEHOLDERS, renderAdminVercelConfig } from "./lib/admin-vercel-config.mjs";
import { buildSupabaseArgs } from "./supabase-env.mjs";
import { renderToFile } from "./render-admin-vercel-config.mjs";
import { FAKE_PRODUCTION_REF, FAKE_STAGING_REF } from "../vitest.shared.mjs";

const REFS = { production: FAKE_PRODUCTION_REF, staging: FAKE_STAGING_REF };

describe("loadProjectRefs", () => {
  it("環境變數優先，其次 root 的 .env", () => {
    const dir = mkdtempSync(join(tmpdir(), "refs-"));
    try {
      writeFileSync(join(dir, ".env"), `# 註解\r\nSUPABASE_STAGING_REF="${FAKE_STAGING_REF}"\r\nSUPABASE_PRODUCTION_REF=${"c".repeat(20)}\r\n`);
      const fromFile = loadProjectRefs({ env: {}, root: dir });
      expect(fromFile).toEqual({ production: "c".repeat(20), staging: FAKE_STAGING_REF });
      const mixed = loadProjectRefs({ env: { SUPABASE_PRODUCTION_REF: FAKE_PRODUCTION_REF }, root: dir });
      expect(mixed).toEqual(REFS);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("格式不對的值當成沒設定", () => {
    const refs = loadProjectRefs({ env: { SUPABASE_PRODUCTION_REF: "too-short", SUPABASE_STAGING_REF: "A".repeat(20) }, root: tmpdir() });
    expect(refs.production).toBe("");
    expect(refs.staging).toBe("");
  });

  it("requireProjectRef 沒設定時說明怎麼設，且不退回任何寫死的值", () => {
    expect(() => requireProjectRef("staging", { production: "", staging: "" })).toThrow(/SUPABASE_STAGING_REF/);
    expect(() => requireProjectRef("nope", REFS)).toThrow(/不認得/);
    expect(requireProjectRef("production", REFS)).toBe(FAKE_PRODUCTION_REF);
  });

  it("environmentOfRef", () => {
    expect(environmentOfRef(FAKE_STAGING_REF, REFS)).toBe("staging");
    expect(environmentOfRef(FAKE_PRODUCTION_REF, REFS)).toBe("production");
    expect(environmentOfRef("", REFS)).toBeNull();
    expect(environmentOfRef("d".repeat(20), REFS)).toBeNull();
  });

  it("parseDotEnv 略過註解與空行", () => {
    expect(parseDotEnv("# a\n\nX=1\nY = 'two'\nbad")).toEqual({ X: "1", Y: "two" });
  });
});

describe("supabase-env 包裝", () => {
  it("把環境換成 --project-ref，並擋掉自帶的 --project-ref", () => {
    expect(buildSupabaseArgs("staging", ["db", "push", "--linked", "--dry-run"], FAKE_STAGING_REF))
      .toEqual(["supabase", "db", "push", "--linked", "--dry-run", "--project-ref", FAKE_STAGING_REF]);
    expect(() => buildSupabaseArgs("staging", ["db", "push", "--project-ref", "x"], FAKE_STAGING_REF)).toThrow(/不要自己帶/);
    expect(() => buildSupabaseArgs("prod", ["db", "push"], FAKE_STAGING_REF)).toThrow(/用法/);
    expect(() => buildSupabaseArgs("staging", [], FAKE_STAGING_REF)).toThrow(/缺少/);
  });
});

describe("vercel.admin.json 占位符", () => {
  const template = JSON.stringify({ csp: `connect-src ${ORIGIN_PLACEHOLDERS.production} ${ORIGIN_PLACEHOLDERS.staging}` });

  it("換成 https://<ref>.supabase.co", () => {
    const out = JSON.parse(renderAdminVercelConfig(template, { refs: REFS, strict: true }));
    expect(out.csp).toBe(`connect-src https://${FAKE_PRODUCTION_REF}.supabase.co https://${FAKE_STAGING_REF}.supabase.co`);
  });

  it("strict 缺 ref 就失敗；非 strict 保持占位符", () => {
    expect(() => renderAdminVercelConfig(template, { refs: { production: "", staging: FAKE_STAGING_REF }, strict: true })).toThrow(/SUPABASE_PRODUCTION_REF/);
    expect(renderAdminVercelConfig(template, { refs: { production: "", staging: "" } })).toBe(template);
  });

  it("repo 裡的 vercel.admin.json 沒有任何真值，換完仍是合法 JSON，renderToFile 會寫出 vercel.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "vercel-"));
    try {
      const source = join(dir, "vercel.admin.json");
      const target = join(dir, "vercel.json");
      writeFileSync(source, template);
      const previous = { ...process.env };
      Object.assign(process.env, { SUPABASE_PRODUCTION_REF: FAKE_PRODUCTION_REF, SUPABASE_STAGING_REF: FAKE_STAGING_REF });
      try {
        renderToFile(source, target);
      } finally {
        process.env.SUPABASE_PRODUCTION_REF = previous.SUPABASE_PRODUCTION_REF;
        process.env.SUPABASE_STAGING_REF = previous.SUPABASE_STAGING_REF;
      }
      expect(JSON.parse(readFileSync(target, "utf8")).csp).toContain(`${FAKE_PRODUCTION_REF}.supabase.co`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
